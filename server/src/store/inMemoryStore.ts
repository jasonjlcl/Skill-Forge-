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
import type {
  DataRetentionPurgeResult,
  DataStore,
  PendingStreamRequest,
  PrivacyDataExport,
} from './types.js';

const DEFAULT_MODULE = 'General Onboarding';

export class InMemoryStore implements DataStore {
  private users: User[] = [];
  private sessions: TrainingSession[] = [];
  private messages: ChatMessage[] = [];
  private quizAttempts: QuizAttempt[] = [];
  private quizQuestions: QuizQuestion[] = [];
  private quizAnswers: QuizAnswer[] = [];
  private moduleProgress: ModuleProgress[] = [];
  private pendingStreamRequests = new Map<
    string,
    {
      id: string;
      userId: string;
      request: PendingStreamRequest;
      expiresAt: Date;
      createdAt: Date;
    }
  >();

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
      tokenVersion: 0,
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
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
    patch: Partial<
      Pick<
        User,
        'language' | 'skillLevel' | 'tokenVersion' | 'failedLoginAttempts' | 'lockedUntil' | 'lastLoginAt'
      >
    >,
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

    if (patch.tokenVersion !== undefined) {
      user.tokenVersion = patch.tokenVersion;
    }

    if (patch.failedLoginAttempts !== undefined) {
      user.failedLoginAttempts = Math.max(0, Math.floor(patch.failedLoginAttempts));
    }

    if (patch.lockedUntil !== undefined) {
      user.lockedUntil = patch.lockedUntil;
    }

    if (patch.lastLoginAt !== undefined) {
      user.lastLoginAt = patch.lastLoginAt;
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

  async createPendingStreamRequest(input: {
    id: string;
    userId: string;
    request: PendingStreamRequest;
    expiresAt: Date;
  }): Promise<void> {
    this.pendingStreamRequests.set(input.id, {
      id: input.id,
      userId: input.userId,
      request: input.request,
      expiresAt: input.expiresAt,
      createdAt: new Date(),
    });
  }

  async consumePendingStreamRequest(input: {
    id: string;
    userId: string;
    now?: Date;
  }): Promise<PendingStreamRequest | null> {
    const existing = this.pendingStreamRequests.get(input.id);
    if (!existing || existing.userId !== input.userId) {
      return null;
    }

    this.pendingStreamRequests.delete(input.id);

    const now = input.now ?? new Date();
    if (existing.expiresAt.getTime() <= now.getTime()) {
      return null;
    }

    return {
      sessionId: existing.request.sessionId,
      message: existing.request.message,
      module: existing.request.module,
      topK: existing.request.topK,
      timeSeconds: existing.request.timeSeconds,
    };
  }

  async purgeExpiredPendingStreamRequests(now?: Date): Promise<number> {
    const cutoff = now ?? new Date();
    let purged = 0;
    for (const [id, entry] of this.pendingStreamRequests.entries()) {
      if (entry.expiresAt.getTime() <= cutoff.getTime()) {
        this.pendingStreamRequests.delete(id);
        purged += 1;
      }
    }
    return purged;
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

  async exportUserData(userId: string): Promise<PrivacyDataExport | null> {
    const user = this.users.find((entry) => entry.id === userId);
    if (!user) {
      return null;
    }

    const sessionRows = this.sessions
      .filter((entry) => entry.userId === userId)
      .slice()
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    const sessionIds = new Set(sessionRows.map((entry) => entry.id));
    const sessionMessages = this.messages
      .filter((entry) => sessionIds.has(entry.sessionId))
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const messagesBySession = new Map<string, ChatMessage[]>();
    for (const message of sessionMessages) {
      const list = messagesBySession.get(message.sessionId);
      if (list) {
        list.push({ ...message });
      } else {
        messagesBySession.set(message.sessionId, [{ ...message }]);
      }
    }

    const attemptRows = this.quizAttempts
      .filter((entry) => entry.userId === userId)
      .slice()
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    const attemptIds = new Set(attemptRows.map((entry) => entry.id));

    const questionsByAttempt = new Map<string, QuizQuestion[]>();
    for (const question of this.quizQuestions) {
      if (!attemptIds.has(question.attemptId)) {
        continue;
      }
      const list = questionsByAttempt.get(question.attemptId);
      if (list) {
        list.push({ ...question });
      } else {
        questionsByAttempt.set(question.attemptId, [{ ...question }]);
      }
    }
    for (const list of questionsByAttempt.values()) {
      list.sort((a, b) => a.position - b.position);
    }

    const answersByAttempt = new Map<string, QuizAnswer[]>();
    for (const answer of this.quizAnswers) {
      if (!attemptIds.has(answer.attemptId)) {
        continue;
      }
      const list = answersByAttempt.get(answer.attemptId);
      if (list) {
        list.push({ ...answer });
      } else {
        answersByAttempt.set(answer.attemptId, [{ ...answer }]);
      }
    }
    for (const list of answersByAttempt.values()) {
      list.sort((a, b) => a.answeredAt.getTime() - b.answeredAt.getTime());
    }

    const pendingStreamRequests = Array.from(this.pendingStreamRequests.values())
      .filter((entry) => entry.userId === userId)
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((entry) => ({
        id: entry.id,
        sessionId: entry.request.sessionId,
        message: entry.request.message,
        module: entry.request.module,
        topK: entry.request.topK,
        timeSeconds: entry.request.timeSeconds,
        expiresAt: new Date(entry.expiresAt),
        createdAt: new Date(entry.createdAt),
      }));

    return {
      generatedAt: new Date(),
      user: {
        id: user.id,
        email: user.email,
        language: user.language,
        skillLevel: user.skillLevel,
        createdAt: new Date(user.createdAt),
        lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt) : null,
      },
      sessions: sessionRows.map((session) => ({
        id: session.id,
        module: session.module,
        startedAt: new Date(session.startedAt),
        lastActiveAt: new Date(session.lastActiveAt),
        messages: (messagesBySession.get(session.id) ?? []).map((message) => ({
          ...message,
          createdAt: new Date(message.createdAt),
        })),
      })),
      quizAttempts: attemptRows.map((attempt) => ({
        id: attempt.id,
        module: attempt.module,
        startedAt: new Date(attempt.startedAt),
        completedAt: attempt.completedAt ? new Date(attempt.completedAt) : null,
        score: attempt.score,
        totalQuestions: attempt.totalQuestions,
        questions: (questionsByAttempt.get(attempt.id) ?? []).map((question) => ({ ...question })),
        answers: (answersByAttempt.get(attempt.id) ?? []).map((answer) => ({
          ...answer,
          answeredAt: new Date(answer.answeredAt),
        })),
      })),
      moduleProgress: this.moduleProgress
        .filter((entry) => entry.userId === userId)
        .map((entry) => ({
          ...entry,
          completedAt: entry.completedAt ? new Date(entry.completedAt) : null,
          updatedAt: new Date(entry.updatedAt),
        })),
      pendingStreamRequests,
    };
  }

  async deleteUserData(userId: string): Promise<boolean> {
    const existing = this.users.some((entry) => entry.id === userId);
    if (!existing) {
      return false;
    }

    const sessionIds = new Set(
      this.sessions.filter((entry) => entry.userId === userId).map((entry) => entry.id),
    );
    const attemptIds = new Set(
      this.quizAttempts.filter((entry) => entry.userId === userId).map((entry) => entry.id),
    );

    this.users = this.users.filter((entry) => entry.id !== userId);
    this.sessions = this.sessions.filter((entry) => entry.userId !== userId);
    this.messages = this.messages.filter((entry) => !sessionIds.has(entry.sessionId));
    this.quizAttempts = this.quizAttempts.filter((entry) => entry.userId !== userId);
    this.quizQuestions = this.quizQuestions.filter((entry) => !attemptIds.has(entry.attemptId));
    this.quizAnswers = this.quizAnswers.filter((entry) => !attemptIds.has(entry.attemptId));
    this.moduleProgress = this.moduleProgress.filter((entry) => entry.userId !== userId);

    for (const [streamId, entry] of this.pendingStreamRequests.entries()) {
      if (entry.userId === userId) {
        this.pendingStreamRequests.delete(streamId);
      }
    }

    return true;
  }

  async purgeRetainedData(input: {
    cutoff: Date;
    userId?: string;
    now?: Date;
  }): Promise<DataRetentionPurgeResult> {
    const cutoffMs = input.cutoff.getTime();
    const nowMs = (input.now ?? new Date()).getTime();
    const shouldIncludeUser = (ownerId: string): boolean => !input.userId || ownerId === input.userId;

    const staleSessionIds = new Set(
      this.sessions
        .filter((entry) => shouldIncludeUser(entry.userId) && entry.lastActiveAt.getTime() <= cutoffMs)
        .map((entry) => entry.id),
    );
    const sessionsDeleted = staleSessionIds.size;
    const messagesDeleted = this.messages.filter((entry) => staleSessionIds.has(entry.sessionId)).length;

    this.sessions = this.sessions.filter((entry) => !staleSessionIds.has(entry.id));
    this.messages = this.messages.filter((entry) => !staleSessionIds.has(entry.sessionId));

    const staleAttemptIds = new Set(
      this.quizAttempts
        .filter((entry) => shouldIncludeUser(entry.userId) && entry.startedAt.getTime() <= cutoffMs)
        .map((entry) => entry.id),
    );
    const quizAttemptsDeleted = staleAttemptIds.size;
    const quizQuestionsDeleted = this.quizQuestions.filter((entry) =>
      staleAttemptIds.has(entry.attemptId),
    ).length;
    const quizAnswersDeleted = this.quizAnswers.filter((entry) =>
      staleAttemptIds.has(entry.attemptId),
    ).length;

    this.quizAttempts = this.quizAttempts.filter((entry) => !staleAttemptIds.has(entry.id));
    this.quizQuestions = this.quizQuestions.filter((entry) => !staleAttemptIds.has(entry.attemptId));
    this.quizAnswers = this.quizAnswers.filter((entry) => !staleAttemptIds.has(entry.attemptId));

    let pendingStreamRequestsDeleted = 0;
    for (const [streamId, entry] of this.pendingStreamRequests.entries()) {
      if (!shouldIncludeUser(entry.userId)) {
        continue;
      }

      if (entry.expiresAt.getTime() <= nowMs || entry.createdAt.getTime() <= cutoffMs) {
        this.pendingStreamRequests.delete(streamId);
        pendingStreamRequestsDeleted += 1;
      }
    }

    return {
      sessionsDeleted,
      messagesDeleted,
      quizAttemptsDeleted,
      quizQuestionsDeleted,
      quizAnswersDeleted,
      pendingStreamRequestsDeleted,
    };
  }
}

export const createInMemoryStore = (): DataStore => new InMemoryStore();
