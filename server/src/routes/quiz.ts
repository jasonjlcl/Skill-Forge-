import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../domain/deps.js';
import { requireAuth } from '../middleware/auth.js';
import { deriveSkillLevel } from '../services/profiling.js';
import { evaluateQuizAnswer } from '../services/quizEvaluation.js';

const startQuizSchema = z.object({
  module: z.string().optional(),
  topic: z.string().optional(),
});

const answerSchema = z.object({
  attemptId: z.string().uuid(),
  questionId: z.string().uuid(),
  userAnswer: z.string().min(1),
  timeOnTaskSeconds: z.coerce.number().optional(),
});

export const createQuizRouter = (deps: AppDeps): Router => {
  const router = Router();

  router.post('/start', requireAuth(deps.store), async (req, res) => {
    const parsed = startQuizSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' });
      return;
    }

    const topic = parsed.data.module || parsed.data.topic || 'General Onboarding';
    const contextChunks = await deps.vectorStore.query({
      query: `${topic} standard operating procedures`,
      topK: 5,
      module: topic,
    });

    const generatedQuestions = await deps.llm.generateQuiz({
      topic,
      language: req.user.language,
      skillLevel: req.user.skillLevel,
      contextChunks,
    });

    const attempt = await deps.store.createQuizAttempt({
      userId: req.user.id,
      module: topic,
      totalQuestions: generatedQuestions.length,
    });

    const storedQuestions = [];
    for (const [index, question] of generatedQuestions.entries()) {
      const stored = await deps.store.createQuizQuestion({
        attemptId: attempt.id,
        position: index,
        prompt: question.prompt,
        type: question.type,
        options: question.type === 'multiple_choice' ? question.options ?? [] : null,
        answerKey: question.answerKey,
        explanation: question.explanation,
      });
      storedQuestions.push(stored);
    }

    res.status(201).json({
      attemptId: attempt.id,
      module: topic,
      questions: storedQuestions.map((question) => ({
        id: question.id,
        position: question.position,
        prompt: question.prompt,
        type: question.type,
        options: question.options,
      })),
    });
  });

  router.post('/answer', requireAuth(deps.store), async (req, res) => {
    const parsed = answerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' });
      return;
    }

    const { attemptId, questionId, userAnswer, timeOnTaskSeconds } = parsed.data;

    const attempt = await deps.store.getQuizAttempt(attemptId);
    if (!attempt || attempt.userId !== req.user.id) {
      res.status(404).json({ error: 'Quiz attempt not found' });
      return;
    }

    const question = await deps.store.getQuizQuestion(questionId);
    if (!question || question.attemptId !== attemptId) {
      res.status(404).json({ error: 'Question not found for this attempt' });
      return;
    }

    const existingAnswers = await deps.store.listQuizAnswers(attemptId);
    if (existingAnswers.some((answer) => answer.questionId === questionId)) {
      res.status(409).json({ error: 'Question already answered' });
      return;
    }

    const isCorrect = evaluateQuizAnswer(question, userAnswer);
    const feedback = isCorrect
      ? `Correct. ${question.explanation}`
      : `Not quite. Expected answer: ${question.answerKey}. ${question.explanation}`;

    await deps.store.createQuizAnswer({
      attemptId,
      questionId,
      userAnswer,
      isCorrect,
      explanation: feedback,
    });

    const answers = await deps.store.listQuizAnswers(attemptId);
    const answeredCount = answers.length;
    const correctCount = answers.filter((answer) => answer.isCorrect).length;
    const scorePercent = Math.round((correctCount / attempt.totalQuestions) * 100);
    const completed = answeredCount >= attempt.totalQuestions;

    if (completed) {
      await deps.store.updateQuizAttempt(attemptId, {
        completedAt: new Date(),
        score: scorePercent,
      });

      const analytics = await deps.store.getAnalytics(req.user.id);
      const nextSkillLevel = deriveSkillLevel(analytics.averageQuizScore);
      if (nextSkillLevel !== req.user.skillLevel) {
        await deps.store.updateUser(req.user.id, { skillLevel: nextSkillLevel });
      }
    }

    await deps.store.upsertModuleProgress({
      userId: req.user.id,
      module: attempt.module,
      timeDeltaSeconds: Math.max(10, Math.floor(timeOnTaskSeconds ?? 20)),
      completed: completed && scorePercent >= 70,
    });

    res.json({
      correct: isCorrect,
      feedback,
      explanation: question.explanation,
      completed,
      scorePercent,
      answeredCount,
      totalQuestions: attempt.totalQuestions,
    });
  });

  return router;
};
