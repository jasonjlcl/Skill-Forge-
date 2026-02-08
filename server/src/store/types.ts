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

export interface DataStore {
  createUser(input: {
    email: string;
    passwordHash: string;
    language: string;
    skillLevel: SkillLevel;
  }): Promise<User>;
  findUserByEmail(email: string): Promise<User | null>;
  getUserById(userId: string): Promise<User | null>;
  updateUser(userId: string, patch: Partial<Pick<User, 'language' | 'skillLevel'>>): Promise<User | null>;

  createSession(input: { userId: string; module: string; id?: string }): Promise<TrainingSession>;
  getSession(sessionId: string): Promise<TrainingSession | null>;
  touchSession(sessionId: string): Promise<void>;

  createMessage(input: {
    sessionId: string;
    role: ChatMessage['role'];
    content: string;
  }): Promise<ChatMessage>;
  listMessages(sessionId: string): Promise<ChatMessage[]>;

  createQuizAttempt(input: {
    userId: string;
    module: string;
    totalQuestions: number;
  }): Promise<QuizAttempt>;
  getQuizAttempt(attemptId: string): Promise<QuizAttempt | null>;
  updateQuizAttempt(
    attemptId: string,
    patch: Partial<Pick<QuizAttempt, 'completedAt' | 'score'>>,
  ): Promise<QuizAttempt | null>;

  createQuizQuestion(input: {
    attemptId: string;
    position: number;
    prompt: string;
    type: QuizQuestion['type'];
    options: string[] | null;
    answerKey: string;
    explanation: string;
  }): Promise<QuizQuestion>;
  getQuizQuestion(questionId: string): Promise<QuizQuestion | null>;
  listQuizQuestions(attemptId: string): Promise<QuizQuestion[]>;

  createQuizAnswer(input: {
    attemptId: string;
    questionId: string;
    userAnswer: string;
    isCorrect: boolean;
    explanation: string;
  }): Promise<QuizAnswer>;
  countQuizAnswers(attemptId: string): Promise<number>;
  listQuizAnswers(attemptId: string): Promise<QuizAnswer[]>;

  upsertModuleProgress(input: {
    userId: string;
    module: string;
    timeDeltaSeconds: number;
    completed: boolean;
  }): Promise<ModuleProgress>;
  listModuleProgress(userId: string): Promise<ModuleProgress[]>;

  getAnalytics(userId: string): Promise<AnalyticsSnapshot>;
}
