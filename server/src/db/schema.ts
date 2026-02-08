import {
  boolean,
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  module: text('module').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const quizAttempts = pgTable('quiz_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  module: text('module').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  score: integer('score'),
  totalQuestions: integer('total_questions').notNull(),
});

export const quizQuestions = pgTable('quiz_questions', {
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
});

export const quizAnswers = pgTable('quiz_answers', {
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
});

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
  quizAttempts,
  quizQuestions,
  quizAnswers,
  moduleProgress,
};
