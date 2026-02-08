import { randomUUID } from 'node:crypto';
import type {
  AnalyticsSnapshot,
  ChatMessage,
  ModuleProgress,
  QuizAnswer,
  QuizAttempt,
  QuizQuestion,
  SkillLevel,
  TrainingSession,
  User,
} from '../domain/types.js';
import type { DataStore } from './types.js';

const DEFAULT_MODULE = 'General Onboarding';

export class InMemoryStore implements DataStore {
  private users: User[] = [];
  private sessions: TrainingSession[] = [];
  private messages: ChatMessage[] = [];
  private quizAttempts: QuizAttempt[] = [];
  private quizQuestions: QuizQuestion[] = [];
  private quizAnswers: QuizAnswer[] = [];
  private moduleProgress: ModuleProgress[] = [];

  async createUser(input: {
    email: string;
    passwordHash: string;
    language: string;
    skillLevel: SkillLevel;
  }): Promise<User> {
    const user: User = {
      id: randomUUID(),
      email: input.email,
      passwordHash: input.passwordHash,
      language: input.language,
      skillLevel: input.skillLevel,
      createdAt: new Date(),
    };
    this.users.push(user);
    return user;
  }

  async findUserByEmail(email: string): Promise<User | null> {
    return this.users.find((entry) => entry.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  async getUserById(userId: string): Promise<User | null> {
    return this.users.find((entry) => entry.id === userId) ?? null;
  }

  async updateUser(
    userId: string,
    patch: Partial<Pick<User, 'language' | 'skillLevel'>>,
  ): Promise<User | null> {
    const user = this.users.find((entry) => entry.id === userId);
    if (!user) {
      return null;
    }

    if (patch.language) {
      user.language = patch.language;
    }

    if (patch.skillLevel) {
      user.skillLevel = patch.skillLevel;
    }

    return user;
  }

  async createSession(input: { userId: string; module: string; id?: string }): Promise<TrainingSession> {
    const session: TrainingSession = {
      id: input.id ?? randomUUID(),
      userId: input.userId,
      module: input.module || DEFAULT_MODULE,
      startedAt: new Date(),
      lastActiveAt: new Date(),
    };
    this.sessions.push(session);
    return session;
  }

  async getSession(sessionId: string): Promise<TrainingSession | null> {
    return this.sessions.find((entry) => entry.id === sessionId) ?? null;
  }

  async touchSession(sessionId: string): Promise<void> {
    const session = this.sessions.find((entry) => entry.id === sessionId);
    if (session) {
      session.lastActiveAt = new Date();
    }
  }

  async createMessage(input: {
    sessionId: string;
    role: ChatMessage['role'];
    content: string;
  }): Promise<ChatMessage> {
    const message: ChatMessage = {
      id: randomUUID(),
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      createdAt: new Date(),
    };
    this.messages.push(message);
    return message;
  }

  async listMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.messages
      .filter((entry) => entry.sessionId === sessionId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async createQuizAttempt(input: {
    userId: string;
    module: string;
    totalQuestions: number;
  }): Promise<QuizAttempt> {
    const attempt: QuizAttempt = {
      id: randomUUID(),
      userId: input.userId,
      module: input.module,
      startedAt: new Date(),
      completedAt: null,
      score: null,
      totalQuestions: input.totalQuestions,
    };
    this.quizAttempts.push(attempt);
    return attempt;
  }

  async getQuizAttempt(attemptId: string): Promise<QuizAttempt | null> {
    return this.quizAttempts.find((entry) => entry.id === attemptId) ?? null;
  }

  async updateQuizAttempt(
    attemptId: string,
    patch: Partial<Pick<QuizAttempt, 'completedAt' | 'score'>>,
  ): Promise<QuizAttempt | null> {
    const attempt = this.quizAttempts.find((entry) => entry.id === attemptId);
    if (!attempt) {
      return null;
    }

    if (patch.completedAt !== undefined) {
      attempt.completedAt = patch.completedAt;
    }

    if (patch.score !== undefined) {
      attempt.score = patch.score;
    }

    return attempt;
  }

  async createQuizQuestion(input: {
    attemptId: string;
    position: number;
    prompt: string;
    type: QuizQuestion['type'];
    options: string[] | null;
    answerKey: string;
    explanation: string;
  }): Promise<QuizQuestion> {
    const question: QuizQuestion = {
      id: randomUUID(),
      attemptId: input.attemptId,
      position: input.position,
      prompt: input.prompt,
      type: input.type,
      options: input.options,
      answerKey: input.answerKey,
      explanation: input.explanation,
    };
    this.quizQuestions.push(question);
    return question;
  }

  async getQuizQuestion(questionId: string): Promise<QuizQuestion | null> {
    return this.quizQuestions.find((entry) => entry.id === questionId) ?? null;
  }

  async listQuizQuestions(attemptId: string): Promise<QuizQuestion[]> {
    return this.quizQuestions
      .filter((entry) => entry.attemptId === attemptId)
      .sort((a, b) => a.position - b.position);
  }

  async createQuizAnswer(input: {
    attemptId: string;
    questionId: string;
    userAnswer: string;
    isCorrect: boolean;
    explanation: string;
  }): Promise<QuizAnswer> {
    const answer: QuizAnswer = {
      id: randomUUID(),
      attemptId: input.attemptId,
      questionId: input.questionId,
      userAnswer: input.userAnswer,
      isCorrect: input.isCorrect,
      explanation: input.explanation,
      answeredAt: new Date(),
    };
    this.quizAnswers.push(answer);
    return answer;
  }

  async countQuizAnswers(attemptId: string): Promise<number> {
    return this.quizAnswers.filter((entry) => entry.attemptId === attemptId).length;
  }

  async listQuizAnswers(attemptId: string): Promise<QuizAnswer[]> {
    return this.quizAnswers
      .filter((entry) => entry.attemptId === attemptId)
      .sort((a, b) => a.answeredAt.getTime() - b.answeredAt.getTime());
  }

  async upsertModuleProgress(input: {
    userId: string;
    module: string;
    timeDeltaSeconds: number;
    completed: boolean;
  }): Promise<ModuleProgress> {
    const existing = this.moduleProgress.find(
      (entry) => entry.userId === input.userId && entry.module === input.module,
    );

    if (existing) {
      existing.timeOnTaskSeconds += Math.max(0, Math.floor(input.timeDeltaSeconds));
      existing.completed = existing.completed || input.completed;
      if (existing.completed && !existing.completedAt) {
        existing.completedAt = new Date();
      }
      existing.updatedAt = new Date();
      return existing;
    }

    const progress: ModuleProgress = {
      id: randomUUID(),
      userId: input.userId,
      module: input.module,
      completed: input.completed,
      completedAt: input.completed ? new Date() : null,
      timeOnTaskSeconds: Math.max(0, Math.floor(input.timeDeltaSeconds)),
      updatedAt: new Date(),
    };
    this.moduleProgress.push(progress);
    return progress;
  }

  async listModuleProgress(userId: string): Promise<ModuleProgress[]> {
    return this.moduleProgress.filter((entry) => entry.userId === userId);
  }

  async getAnalytics(userId: string): Promise<AnalyticsSnapshot> {
    const user = this.users.find((entry) => entry.id === userId);
    const attempts = this.quizAttempts.filter((entry) => entry.userId === userId);
    const finishedAttempts = attempts.filter((entry) => entry.score !== null && entry.completedAt !== null);
    const progress = this.moduleProgress.filter((entry) => entry.userId === userId);

    const averageQuizScore =
      finishedAttempts.length === 0
        ? 0
        : Math.round(
            finishedAttempts.reduce((sum, attempt) => sum + (attempt.score ?? 0), 0) /
              finishedAttempts.length,
          );

    const scoreByModule = new Map<string, number>();
    for (const attempt of finishedAttempts) {
      const current = scoreByModule.get(attempt.module);
      const score = attempt.score ?? 0;
      if (current === undefined || score > current) {
        scoreByModule.set(attempt.module, score);
      }
    }

    const moduleBreakdown = progress.map((entry) => ({
      module: entry.module,
      completed: entry.completed,
      timeOnTaskSeconds: entry.timeOnTaskSeconds,
      bestScore: scoreByModule.get(entry.module) ?? null,
    }));

    const recentQuizScores = finishedAttempts
      .slice()
      .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))
      .slice(0, 10)
      .map((entry) => ({
        module: entry.module,
        score: entry.score ?? 0,
        completedAt: (entry.completedAt ?? new Date()).toISOString(),
      }));

    return {
      userId,
      currentSkillLevel: user?.skillLevel ?? 'beginner',
      totalQuizAttempts: attempts.length,
      averageQuizScore,
      completedModules: progress.filter((entry) => entry.completed).length,
      totalTimeOnTaskSeconds: progress.reduce((sum, entry) => sum + entry.timeOnTaskSeconds, 0),
      moduleBreakdown,
      recentQuizScores,
    };
  }
}

export const createInMemoryStore = (): DataStore => new InMemoryStore();
