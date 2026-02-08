import type {
  AnalyticsSnapshot,
  ChatDoneEvent,
  ChatMetaEvent,
  ChatTokenEvent,
  Module,
  QuizQuestion,
  SkillLevel,
  Source,
  UserProfile,
} from '../types';

const apiBase = import.meta.env.VITE_API_BASE ?? '';

const fallbackModules = ['Safety Basics', 'Machine Setup', 'Quality Control', 'Preventive Maintenance'];

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(payload.error ?? 'Request failed');
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
};

export interface SendMessageInput {
  message: string;
  module: string;
  sessionId?: string;
  topK?: number;
  timeSeconds?: number;
}

export interface SendMessageHandlers {
  onMeta?: (payload: ChatMetaEvent) => void;
  onToken?: (payload: ChatTokenEvent) => void;
  onDone?: (payload: ChatDoneEvent) => void;
  onError?: (error: Event) => void;
}

export const sendMessage = (input: SendMessageInput, handlers: SendMessageHandlers): EventSource => {
  const params = new URLSearchParams({
    message: input.message,
    module: input.module,
    top_k: String(input.topK ?? 4),
    time_seconds: String(input.timeSeconds ?? 15),
  });

  if (input.sessionId) {
    params.set('session_id', input.sessionId);
  }

  const source = new EventSource(`${apiBase}/chat/stream?${params.toString()}`, {
    withCredentials: true,
  });

  source.addEventListener('meta', (event) => {
    const payload = JSON.parse((event as MessageEvent<string>).data) as ChatMetaEvent;
    handlers.onMeta?.({
      ...payload,
      sources: (payload.sources ?? []).map((source) => ({
        ...source,
        excerpt: source.source,
      })),
    });
  });

  source.addEventListener('token', (event) => {
    const payload = JSON.parse((event as MessageEvent<string>).data) as ChatTokenEvent;
    handlers.onToken?.(payload);
  });

  source.addEventListener('done', (event) => {
    const payload = JSON.parse((event as MessageEvent<string>).data) as ChatDoneEvent;
    handlers.onDone?.(payload);
  });

  source.onerror = (event) => {
    handlers.onError?.(event);
  };

  return source;
};

export const getModules = async (): Promise<Module[]> => {
  return fallbackModules.map((name) => ({
    id: name,
    name,
    status: 'not_started',
    progress: 0,
    completedAt: null,
  }));
};

export const register = (payload: {
  email: string;
  password: string;
  language: string;
  skillLevel: SkillLevel;
}) => request<{ user: UserProfile }>('/auth/register', { method: 'POST', body: JSON.stringify(payload) });

export const login = (payload: { email: string; password: string }) =>
  request<{ user: UserProfile }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const logout = () => request<null>('/auth/logout', { method: 'POST', body: '{}' });

export const me = () => request<{ user: UserProfile }>('/auth/me');

export const createSession = (module: string) =>
  request<{ sessionId: string; module: string; startedAt: string }>('/chat/session', {
    method: 'POST',
    body: JSON.stringify({ module }),
  });

export const explainMessage = (payload: {
  sessionId?: string;
  module?: string;
  question: string;
  answer: string;
}) =>
  request<{ explanation: string; sources: Source[] }>('/chat/explain', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const startQuiz = (module: string) =>
  request<{ attemptId: string; module: string; questions: QuizQuestion[] }>('/quiz/start', {
    method: 'POST',
    body: JSON.stringify({ module }),
  });

export const submitQuizAnswer = (payload: {
  attemptId: string;
  questionId: string;
  userAnswer: string;
  timeOnTaskSeconds: number;
}) =>
  request<{
    correct: boolean;
    feedback: string;
    explanation: string;
    completed: boolean;
    scorePercent: number;
    answeredCount: number;
    totalQuestions: number;
  }>('/quiz/answer', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const getAnalytics = () => request<AnalyticsSnapshot>('/me/analytics');

export const api = {
  register,
  login,
  logout,
  me,
  getModules,
  createSession,
  sendMessage,
  explainMessage,
  startQuiz,
  submitQuizAnswer,
  getAnalytics,
};

