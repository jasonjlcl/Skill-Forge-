import { useMemo, useState } from 'react';
import { ArrowRight, CircleCheck, RefreshCw, ShieldAlert } from 'lucide-react';
import { startQuiz, submitQuizAnswer } from '../lib/api';
import type { QuizAttempt, QuizQuestion } from '../types';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

interface QuizProps {
  selectedModule: string;
  onAnalyticsRefresh?: () => void | Promise<void>;
}

interface AnswerState {
  userAnswer: string;
  correct: boolean;
  feedback: string;
}

const parseChoiceValue = (option: string): string => {
  const match = option.trim().match(/^([A-Z])\)/i);
  return match?.[1]?.toUpperCase() ?? option;
};

const extractWeakTopic = (question: QuizQuestion): string => {
  const phrase = question.prompt
    .replace(/[^a-z0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(' ')
    .trim();

  return phrase || 'Operational decision-making';
};

export const Quiz = ({ selectedModule, onAnalyticsRefresh }: QuizProps) => {
  const [attempt, setAttempt] = useState<QuizAttempt | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [startLoading, setStartLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentQuestion = attempt?.questions[currentIndex] ?? null;
  const currentResult = currentQuestion ? answers[currentQuestion.id] : undefined;

  const progressPercent = attempt
    ? Math.round((Math.max(0, currentIndex) / Math.max(1, attempt.totalQuestions)) * 100)
    : 0;

  const weakTopics = useMemo(() => {
    if (!attempt) {
      return [];
    }

    return attempt.questions
      .filter((question) => {
        const result = answers[question.id];
        return result && !result.correct;
      })
      .map((question) => extractWeakTopic(question));
  }, [attempt, answers]);

  const launchQuiz = async () => {
    setStartLoading(true);
    setError(null);

    try {
      const payload = await startQuiz(selectedModule);
      setAttempt({
        attemptId: payload.attemptId,
        module: payload.module,
        questions: payload.questions,
        answeredCount: 0,
        totalQuestions: payload.questions.length,
        scorePercent: null,
        completed: false,
      });
      setCurrentIndex(0);
      setCurrentAnswer('');
      setAnswers({});
      void onAnalyticsRefresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate quiz right now.');
    } finally {
      setStartLoading(false);
    }
  };

  const submitCurrent = async () => {
    if (!attempt || !currentQuestion || !currentAnswer.trim() || submitLoading || currentResult) {
      return;
    }

    setSubmitLoading(true);
    setError(null);

    try {
      const payload = await submitQuizAnswer({
        attemptId: attempt.attemptId,
        questionId: currentQuestion.id,
        userAnswer: currentAnswer.trim(),
        timeOnTaskSeconds: 20,
      });

      setAnswers((previous) => ({
        ...previous,
        [currentQuestion.id]: {
          userAnswer: currentAnswer,
          correct: payload.correct,
          feedback: payload.feedback,
        },
      }));

      setAttempt((previous) =>
        previous
          ? {
              ...previous,
              answeredCount: payload.answeredCount,
              scorePercent: payload.completed ? payload.scorePercent : previous.scorePercent,
              completed: payload.completed,
            }
          : previous,
      );

      if (payload.completed) {
        void onAnalyticsRefresh?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit answer.');
    } finally {
      setSubmitLoading(false);
    }
  };

  const moveNext = () => {
    if (!attempt) {
      return;
    }

    if (currentIndex < attempt.totalQuestions - 1) {
      setCurrentIndex((value) => value + 1);
      setCurrentAnswer('');
    }
  };

  const allDone = Boolean(attempt?.completed);

  return (
    <section className="rounded-2xl border border-white/15 bg-black/30 p-4 text-slate-100 backdrop-blur-xl sm:p-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{selectedModule} Quiz Lab</h2>
          <p className="text-sm text-slate-400">One question at a time with immediate feedback and focused retry.</p>
        </div>
        <Button
          onClick={() => {
            void launchQuiz();
          }}
          disabled={startLoading}
          className="rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 text-slate-950 hover:from-cyan-300 hover:to-violet-400"
        >
          {startLoading ? 'Generating...' : attempt ? 'Regenerate Quiz' : 'Start Quiz'}
        </Button>
      </header>

      {error ? <p className="mb-3 rounded-xl border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-sm">{error}</p> : null}

      {!attempt ? (
        <p className="text-sm text-slate-300">
          Start a quiz to assess operator readiness for this module. Questions are adapted to the training context.
        </p>
      ) : null}

      {attempt && !allDone && currentQuestion ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-400">
              <span>
                Question {currentIndex + 1} / {attempt.totalQuestions}
              </span>
              <span>{progressPercent}%</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-violet-400"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
            <p className="text-base leading-7 text-slate-100">{currentQuestion.prompt}</p>

            {currentQuestion.type === 'multiple_choice' ? (
              <div className="mt-4 space-y-2">
                {(currentQuestion.options ?? []).map((option) => {
                  const value = parseChoiceValue(option);
                  const selected = currentAnswer === value;
                  return (
                    <button
                      key={option}
                      type="button"
                      className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition ${
                        selected
                          ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-100'
                          : 'border-white/10 bg-white/5 text-slate-200 hover:border-white/20 hover:bg-white/10'
                      }`}
                      onClick={() => setCurrentAnswer(value)}
                      disabled={Boolean(currentResult)}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            ) : (
              <Textarea
                value={currentAnswer}
                onChange={(event) => setCurrentAnswer(event.target.value)}
                placeholder="Type a short answer"
                className="mt-4"
                disabled={Boolean(currentResult)}
              />
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {!currentResult ? (
                <Button
                  onClick={() => {
                    void submitCurrent();
                  }}
                  disabled={!currentAnswer.trim() || submitLoading}
                  className="rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 text-slate-950 hover:from-cyan-300 hover:to-violet-400"
                >
                  {submitLoading ? 'Checking...' : 'Submit Answer'}
                </Button>
              ) : (
                <Button
                  onClick={moveNext}
                  disabled={currentIndex >= attempt.totalQuestions - 1}
                  className="rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 text-slate-950 hover:from-cyan-300 hover:to-violet-400"
                >
                  Next Question
                  <ArrowRight size={14} className="ml-1.5" />
                </Button>
              )}
            </div>

            {currentResult ? (
              <div
                className={`mt-4 rounded-xl border px-3 py-2 text-sm ${
                  currentResult.correct
                    ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100'
                    : 'border-amber-300/30 bg-amber-400/10 text-amber-100'
                }`}
              >
                <div className="mb-1 flex items-center gap-2 font-semibold">
                  {currentResult.correct ? (
                    <CircleCheck size={15} className="text-emerald-200" />
                  ) : (
                    <ShieldAlert size={15} className="text-amber-200" />
                  )}
                  {currentResult.correct ? 'Correct' : 'Needs Review'}
                </div>
                <p>{currentResult.feedback}</p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {allDone && attempt ? (
        <div className="rounded-2xl border border-white/15 bg-white/5 p-5">
          <h3 className="text-lg font-semibold text-slate-100">Quiz complete</h3>
          <p className="mt-1 text-sm text-slate-300">Final score: {attempt.scorePercent ?? 0}%</p>

          <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Weak topics</p>
            {weakTopics.length === 0 ? (
              <p className="mt-2 text-sm text-emerald-200">No weak topics detected. Great job.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-slate-200">
                {weakTopics.map((topic) => (
                  <li key={topic} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    {topic}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              onClick={() => {
                void launchQuiz();
              }}
              className="rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 text-slate-950 hover:from-cyan-300 hover:to-violet-400"
            >
              <RefreshCw size={15} className="mr-1.5" />
              Retry Focused Quiz
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
};

