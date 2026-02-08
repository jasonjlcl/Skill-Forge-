export type SkillLevel = 'beginner' | 'intermediate' | 'advanced';

export type QuizQuestionType = 'multiple_choice' | 'short_answer';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  language: string;
  skillLevel: SkillLevel;
  createdAt: Date;
}

export interface TrainingSession {
  id: string;
  userId: string;
  module: string;
  startedAt: Date;
  lastActiveAt: Date;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: Date;
}

export interface QuizAttempt {
  id: string;
  userId: string;
  module: string;
  startedAt: Date;
  completedAt: Date | null;
  score: number | null;
  totalQuestions: number;
}

export interface QuizQuestion {
  id: string;
  attemptId: string;
  position: number;
  prompt: string;
  type: QuizQuestionType;
  options: string[] | null;
  answerKey: string;
  explanation: string;
}

export interface QuizAnswer {
  id: string;
  attemptId: string;
  questionId: string;
  userAnswer: string;
  isCorrect: boolean;
  explanation: string;
  answeredAt: Date;
}

export interface ModuleProgress {
  id: string;
  userId: string;
  module: string;
  completed: boolean;
  completedAt: Date | null;
  timeOnTaskSeconds: number;
  updatedAt: Date;
}

export interface AnalyticsSnapshot {
  userId: string;
  currentSkillLevel: SkillLevel;
  totalQuizAttempts: number;
  averageQuizScore: number;
  completedModules: number;
  totalTimeOnTaskSeconds: number;
  moduleBreakdown: Array<{
    module: string;
    completed: boolean;
    timeOnTaskSeconds: number;
    bestScore: number | null;
  }>;
  recentQuizScores: Array<{
    module: string;
    score: number;
    completedAt: string;
  }>;
}

export interface QuizQuestionDraft {
  prompt: string;
  type: QuizQuestionType;
  options?: string[];
  answerKey: string;
  explanation: string;
}
