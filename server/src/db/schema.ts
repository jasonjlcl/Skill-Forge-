import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  language: text('language').notNull().default('en'),
  skillLevel: text('skill_level').notNull().default('beginner'),
  tokenVersion: integer('token_version').notNull().default(0),
  failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    module: text('module').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sessionsUserLastActiveIdx: index('sessions_user_last_active_idx').on(table.userId, table.lastActiveAt),
  }),
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    messagesSessionCreatedAtIdx: index('messages_session_created_at_idx').on(
      table.sessionId,
      table.createdAt,
    ),
  }),
);

export const pendingStreamRequests = pgTable(
  'pending_stream_requests',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id'),
    message: text('message').notNull(),
    module: text('module'),
    topK: integer('top_k'),
    timeSeconds: integer('time_seconds'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pendingStreamRequestsUserExpiresIdx: index('pending_stream_requests_user_expires_idx').on(
      table.userId,
      table.expiresAt,
    ),
    pendingStreamRequestsExpiresIdx: index('pending_stream_requests_expires_idx').on(table.expiresAt),
  }),
);

export const quizAttempts = pgTable(
  'quiz_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    module: text('module').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    score: integer('score'),
    totalQuestions: integer('total_questions').notNull(),
  },
  (table) => ({
    quizAttemptsUserStartedAtIdx: index('quiz_attempts_user_started_at_idx').on(
      table.userId,
      table.startedAt,
    ),
  }),
);

export const quizQuestions = pgTable(
  'quiz_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => quizAttempts.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    prompt: text('prompt').notNull(),
    type: text('type').notNull(),
    options: jsonb('options').$type<string[] | null>(),
    answerKey: text('answer_key').notNull(),
    explanation: text('explanation').notNull(),
  },
  (table) => ({
    quizQuestionsAttemptPositionIdx: index('quiz_questions_attempt_position_idx').on(
      table.attemptId,
      table.position,
    ),
  }),
);

export const quizAnswers = pgTable(
  'quiz_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => quizAttempts.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => quizQuestions.id, { onDelete: 'cascade' }),
    userAnswer: text('user_answer').notNull(),
    isCorrect: boolean('is_correct').notNull(),
    explanation: text('explanation').notNull(),
    answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    quizAnswersAttemptAnsweredAtIdx: index('quiz_answers_attempt_answered_at_idx').on(
      table.attemptId,
      table.answeredAt,
    ),
  }),
);

export const moduleProgress = pgTable(
  'module_progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    module: text('module').notNull(),
    completed: boolean('completed').notNull().default(false),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    timeOnTaskSeconds: integer('time_on_task_seconds').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueUserModule: uniqueIndex('module_progress_user_module_idx').on(table.userId, table.module),
  }),
);

export const schema = {
  users,
  sessions,
  messages,
  pendingStreamRequests,
  quizAttempts,
  quizQuestions,
  quizAnswers,
  moduleProgress,
};
