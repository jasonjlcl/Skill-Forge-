import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  messages,
  moduleProgress,
  quizAnswers,
  quizAttempts,
  quizQuestions,
  sessions,
  users,
} from '../db/schema.js';
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

const toSkillLevel = (value: string): SkillLevel => {
  if (value === 'advanced' || value === 'intermediate' || value === 'beginner') {
    return value;
  }
  return 'beginner';
};

const assertDb = () => {
  const db = getDb();
  if (!db) {
    throw new Error('DATABASE_URL is required for PostgresStore');
  }
  return db;
};

export class PostgresStore implements DataStore {
  async createUser(input: {
    email: string;
    passwordHash: string;
    language: string;
    skillLevel: SkillLevel;
  }): Promise<User> {
    const db = assertDb();
    const [created] = await db
      .insert(users)
      .values({
        email: input.email,
        passwordHash: input.passwordHash,
        language: input.language,
        skillLevel: input.skillLevel,
      })
      .returning();

    return {
      ...created,
      skillLevel: toSkillLevel(created.skillLevel),
    };
  }

  async findUserByEmail(email: string): Promise<User | null> {
    const db = assertDb();
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user) {
      return null;
    }
    return {
      ...user,
      skillLevel: toSkillLevel(user.skillLevel),
    };
  }

  async getUserById(userId: string): Promise<User | null> {
    const db = assertDb();
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      return null;
    }
    return {
      ...user,
      skillLevel: toSkillLevel(user.skillLevel),
    };
  }

  async updateUser(
    userId: string,
    patch: Partial<Pick<User, 'language' | 'skillLevel'>>,
  ): Promise<User | null> {
    const db = assertDb();
    const [updated] = await db
      .update(users)
      .set({
        language: patch.language,
        skillLevel: patch.skillLevel,
      })
      .where(eq(users.id, userId))
      .returning();

    if (!updated) {
      return null;
    }

    return {
      ...updated,
      skillLevel: toSkillLevel(updated.skillLevel),
    };
  }

  async createSession(input: { userId: string; module: string; id?: string }): Promise<TrainingSession> {
    const db = assertDb();
    const [created] = await db
      .insert(sessions)
      .values({
        id: input.id,
        userId: input.userId,
        module: input.module,
      })
      .returning();
    return created;
  }

  async getSession(sessionId: string): Promise<TrainingSession | null> {
    const db = assertDb();
    const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    return session ?? null;
  }

  async touchSession(sessionId: string): Promise<void> {
    const db = assertDb();
    await db
      .update(sessions)
      .set({
        lastActiveAt: new Date(),
      })
      .where(eq(sessions.id, sessionId));
  }

  async createMessage(input: {
    sessionId: string;
    role: ChatMessage['role'];
    content: string;
  }): Promise<ChatMessage> {
    const db = assertDb();
    const [created] = await db.insert(messages).values(input).returning();
    return {
      ...created,
      role: created.role as ChatMessage['role'],
    };
  }

  async listMessages(sessionId: string): Promise<ChatMessage[]> {
    const db = assertDb();
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt);

    return rows.map((entry) => ({
      ...entry,
      role: entry.role as ChatMessage['role'],
    }));
  }

  async createQuizAttempt(input: {
    userId: string;
    module: string;
    totalQuestions: number;
  }): Promise<QuizAttempt> {
    const db = assertDb();
    const [created] = await db.insert(quizAttempts).values(input).returning();
    return {
      ...created,
      score: created.score,
    };
  }

  async getQuizAttempt(attemptId: string): Promise<QuizAttempt | null> {
    const db = assertDb();
    const [attempt] = await db.select().from(quizAttempts).where(eq(quizAttempts.id, attemptId)).limit(1);
    if (!attempt) {
      return null;
    }

    return {
      ...attempt,
      score: attempt.score,
    };
  }

  async updateQuizAttempt(
    attemptId: string,
    patch: Partial<Pick<QuizAttempt, 'completedAt' | 'score'>>,
  ): Promise<QuizAttempt | null> {
    const db = assertDb();
    const [updated] = await db
      .update(quizAttempts)
      .set({
        completedAt: patch.completedAt,
        score:
          typeof patch.score === 'number'
            ? Math.round(patch.score)
            : patch.score === null
              ? null
              : undefined,
      })
      .where(eq(quizAttempts.id, attemptId))
      .returning();

    if (!updated) {
      return null;
    }

    return {
      ...updated,
      score: updated.score,
    };
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
    const db = assertDb();
    const [created] = await db.insert(quizQuestions).values(input).returning();
    return {
      ...created,
      type: created.type as QuizQuestion['type'],
    };
  }

  async getQuizQuestion(questionId: string): Promise<QuizQuestion | null> {
    const db = assertDb();
    const [question] = await db
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.id, questionId))
      .limit(1);
    if (!question) {
      return null;
    }

    return {
      ...question,
      type: question.type as QuizQuestion['type'],
    };
  }

  async listQuizQuestions(attemptId: string): Promise<QuizQuestion[]> {
    const db = assertDb();
    const rows = await db
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.attemptId, attemptId))
      .orderBy(quizQuestions.position);

    return rows.map((row) => ({
      ...row,
      type: row.type as QuizQuestion['type'],
    }));
  }

  async createQuizAnswer(input: {
    attemptId: string;
    questionId: string;
    userAnswer: string;
    isCorrect: boolean;
    explanation: string;
  }): Promise<QuizAnswer> {
    const db = assertDb();
    const [created] = await db.insert(quizAnswers).values(input).returning();
    return created;
  }

  async countQuizAnswers(attemptId: string): Promise<number> {
    const db = assertDb();
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(quizAnswers)
      .where(eq(quizAnswers.attemptId, attemptId));
    return Number(row?.count ?? 0);
  }

  async listQuizAnswers(attemptId: string): Promise<QuizAnswer[]> {
    const db = assertDb();
    const rows = await db
      .select()
      .from(quizAnswers)
      .where(eq(quizAnswers.attemptId, attemptId))
      .orderBy(quizAnswers.answeredAt);
    return rows;
  }

  async upsertModuleProgress(input: {
    userId: string;
    module: string;
    timeDeltaSeconds: number;
    completed: boolean;
  }): Promise<ModuleProgress> {
    const db = assertDb();
    const delta = Math.max(0, Math.floor(input.timeDeltaSeconds));
    const [progress] = await db
      .insert(moduleProgress)
      .values({
        userId: input.userId,
        module: input.module,
        completed: input.completed,
        completedAt: input.completed ? new Date() : null,
        timeOnTaskSeconds: delta,
      })
      .onConflictDoUpdate({
        target: [moduleProgress.userId, moduleProgress.module],
        set: {
          completed: sql`${moduleProgress.completed} OR ${input.completed}`,
          completedAt: input.completed ? new Date() : moduleProgress.completedAt,
          timeOnTaskSeconds: sql`${moduleProgress.timeOnTaskSeconds} + ${delta}`,
          updatedAt: new Date(),
        },
      })
      .returning();

    return progress;
  }

  async listModuleProgress(userId: string): Promise<ModuleProgress[]> {
    const db = assertDb();
    return db.select().from(moduleProgress).where(eq(moduleProgress.userId, userId));
  }

  async getAnalytics(userId: string): Promise<AnalyticsSnapshot> {
    const db = assertDb();

    const user = await this.getUserById(userId);
    const attempts = await db.select().from(quizAttempts).where(eq(quizAttempts.userId, userId));
    const progressRows = await db.select().from(moduleProgress).where(eq(moduleProgress.userId, userId));

    const finishedAttempts = attempts.filter((entry) => entry.completedAt !== null && entry.score !== null);

    const averageQuizScore =
      finishedAttempts.length === 0
        ? 0
        : Math.round(
            finishedAttempts.reduce((sum, attempt) => sum + (attempt.score ?? 0), 0) /
              finishedAttempts.length,
          );

    const recentQuizScores = finishedAttempts
      .slice()
      .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))
      .slice(0, 10)
      .map((entry) => ({
        module: entry.module,
        score: entry.score ?? 0,
        completedAt: (entry.completedAt ?? new Date()).toISOString(),
      }));

    const bestScores = new Map<string, number>();
    for (const attempt of finishedAttempts) {
      const score = attempt.score ?? 0;
      const current = bestScores.get(attempt.module);
      if (current === undefined || score > current) {
        bestScores.set(attempt.module, score);
      }
    }

    const moduleBreakdown = progressRows.map((row) => ({
      module: row.module,
      completed: row.completed,
      timeOnTaskSeconds: row.timeOnTaskSeconds,
      bestScore: bestScores.get(row.module) ?? null,
    }));

    return {
      userId,
      currentSkillLevel: user?.skillLevel ?? 'beginner',
      totalQuizAttempts: attempts.length,
      averageQuizScore,
      completedModules: progressRows.filter((row) => row.completed).length,
      totalTimeOnTaskSeconds: progressRows.reduce((sum, row) => sum + row.timeOnTaskSeconds, 0),
      moduleBreakdown,
      recentQuizScores,
    };
  }
}

export const createPostgresStore = (): DataStore => new PostgresStore();
