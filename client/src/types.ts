export type SkillLevel = 'beginner' | 'intermediate' | 'advanced';

export type ModuleStatus = 'not_started' | 'in_progress' | 'completed';

export type MessageRole = 'user' | 'assistant';

export interface Source {
  id: string;
  source: string;
  score: number;
  excerpt?: string;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  question?: string;
  sources?: Source[];
  explainWhy?: string;
  isStreaming?: boolean;
}

export interface Module {
  id: string;
  name: string;
  status: ModuleStatus;
  progress: number;
  completedAt?: string | null;
}

export interface QuizQuestion {
  id: string;
  position: number;
  prompt: string;
  type: 'multiple_choice' | 'short_answer';
  options: string[] | null;
}

export interface QuizAttempt {
  attemptId: string;
  module: string;
  questions: QuizQuestion[];
  answeredCount: number;
  totalQuestions: number;
  scorePercent: number | null;
  completed: boolean;
}

export interface UserProfile {
  id: string;
  email: string;
  language: string;
  skillLevel: SkillLevel;
  createdAt: string;
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

export interface ChatMetaEvent {
  sessionId: string;
  module: string;
  sources: Source[];
}

export interface ChatTokenEvent {
  token: string;
}

export interface ChatDoneEvent {
  sessionId: string;
  answer: string;
}

export type ChatErrorKind = 'network' | 'retrieval' | 'model';

export interface ChatErrorState {
  kind: ChatErrorKind;
  message: string;
}

