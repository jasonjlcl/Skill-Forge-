import request from 'supertest';
import { createApp } from '../src/app.js';
import type { AppOverrides } from '../src/app.js';
import type { QuizQuestionDraft } from '../src/domain/types.js';
import type { LlmClient } from '../src/services/gemini.js';
import { InMemoryVectorStore } from '../src/services/vectorStore.js';
import { InMemoryStore } from '../src/store/inMemoryStore.js';

const toCookieHeader = (setCookie: string[] | undefined): string =>
  (setCookie ?? []).map((entry) => entry.split(';')[0]).join('; ');

const normalizeSetCookie = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  if (typeof value === 'string') {
    return [value];
  }
  return undefined;
};

const extractCookieValue = (setCookie: string[] | undefined, name: string): string | null => {
  for (const entry of setCookie ?? []) {
    const [pair] = entry.split(';');
    const [cookieName, ...valueParts] = pair.split('=');
    if (cookieName === name) {
      return valueParts.join('=');
    }
  }
  return null;
};

const fakeLlm: LlmClient = {
  async generateAssistance() {
    return { answer: 'Follow SOP step by step. Why: this reduces safety risk.' };
  },
  async generateQuiz(): Promise<QuizQuestionDraft[]> {
    return [
      {
        prompt: 'What is the first safety check?',
        type: 'multiple_choice',
        options: ['A) Start machine', 'B) Verify PPE', 'C) Skip checks', 'D) Call vendor'],
        answerKey: 'B',
        explanation: 'PPE verification comes first.',
      },
      {
        prompt: 'Why is lockout/tagout used?',
        type: 'short_answer',
        answerKey: 'prevents unexpected machine startup',
        explanation: 'It controls hazardous energy.',
      },
      {
        prompt: 'Out-of-tolerance measurement means?',
        type: 'multiple_choice',
        options: ['A) Ignore', 'B) Continue', 'C) Stop and report', 'D) Disable alarm'],
        answerKey: 'C',
        explanation: 'Stop and escalate per SOP.',
      },
    ];
  },
  async explainWhy() {
    return 'Reasoning references SOP safety checkpoints.';
  },
};

const buildTestApp = () => {
  const store = new InMemoryStore();
  const vectorStore = new InMemoryVectorStore();

  const overrides: AppOverrides = {
    store,
    llm: fakeLlm,
    vectorStore,
    env: {
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: undefined,
      GEMINI_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
      JWT_SECRET: 'test-secret-with-length',
      RATE_LIMIT_MAX: 1000,
      AUTH_RATE_LIMIT_MAX: 1000,
      LOGIN_MAX_ATTEMPTS: 5,
      LOGIN_LOCKOUT_MINUTES: 15,
      STREAM_REQUEST_TTL_SECONDS: 120,
      authRateLimitMax: 1000,
      loginMaxAttempts: 5,
      loginLockoutMinutes: 15,
      streamRequestTtlSeconds: 120,
      CLIENT_URL: 'http://localhost:5173',
      CHROMA_URL: undefined,
      CHROMA_COLLECTION: 'test_collection',
      COOKIE_SECURE: 'false',
      cookieSecure: false,
    },
  };

  return { app: createApp(overrides), store, vectorStore };
};

describe('API', () => {
  it('registers and returns analytics', async () => {
    const { app } = buildTestApp();

    const register = await request(app)
      .post('/auth/register')
      .send({ email: 'worker@example.com', password: 'strong-pass-123', language: 'en' })
      .expect(201);

    const setCookie = normalizeSetCookie(register.headers['set-cookie']);
    const cookieHeader = toCookieHeader(setCookie);
    expect(cookieHeader).toBeTruthy();

    const analytics = await request(app).get('/me/analytics').set('Cookie', cookieHeader).expect(200);
    expect(analytics.body.currentSkillLevel).toBe('beginner');
    expect(analytics.body.totalQuizAttempts).toBe(0);
  });

  it('starts a quiz and records an answer', async () => {
    const { app } = buildTestApp();

    const register = await request(app)
      .post('/auth/register')
      .send({ email: 'operator@example.com', password: 'strong-pass-123', language: 'en' })
      .expect(201);

    const setCookie = normalizeSetCookie(register.headers['set-cookie']);
    const cookieHeader = toCookieHeader(setCookie);
    const csrfToken = extractCookieValue(setCookie, 'csrf_token');
    expect(csrfToken).toBeTruthy();

    const quizStart = await request(app)
      .post('/quiz/start')
      .set('Cookie', cookieHeader)
      .set('x-csrf-token', csrfToken as string)
      .send({ module: 'Safety Basics' })
      .expect(201);

    expect(quizStart.body.questions).toHaveLength(3);

    const firstQuestion = quizStart.body.questions[0];

    const answer = await request(app)
      .post('/quiz/answer')
      .set('Cookie', cookieHeader)
      .set('x-csrf-token', csrfToken as string)
      .send({
        attemptId: quizStart.body.attemptId,
        questionId: firstQuestion.id,
        userAnswer: 'B',
        timeOnTaskSeconds: 30,
      })
      .expect(200);

    expect(answer.body.correct).toBe(true);
    expect(answer.body.answeredCount).toBe(1);
  });

  it('rejects authenticated mutating requests without a CSRF token', async () => {
    const { app } = buildTestApp();

    const register = await request(app)
      .post('/auth/register')
      .send({ email: 'csrf@example.com', password: 'strong-pass-123', language: 'en' })
      .expect(201);

    const setCookie = normalizeSetCookie(register.headers['set-cookie']);
    const cookieHeader = toCookieHeader(setCookie);

    await request(app)
      .post('/quiz/start')
      .set('Cookie', cookieHeader)
      .send({ module: 'Safety Basics' })
      .expect(403);
  });

  it('revokes session tokens on logout', async () => {
    const { app } = buildTestApp();

    const register = await request(app)
      .post('/auth/register')
      .send({ email: 'revoke@example.com', password: 'strong-pass-123', language: 'en' })
      .expect(201);

    const setCookie = normalizeSetCookie(register.headers['set-cookie']);
    const cookieHeader = toCookieHeader(setCookie);
    const csrfToken = extractCookieValue(setCookie, 'csrf_token');
    expect(csrfToken).toBeTruthy();

    await request(app)
      .post('/auth/logout')
      .set('Cookie', cookieHeader)
      .set('x-csrf-token', csrfToken as string)
      .send({})
      .expect(204);

    await request(app).get('/auth/me').set('Cookie', cookieHeader).expect(401);
  });

  it('locks an account after repeated failed login attempts', async () => {
    const { app } = buildTestApp();

    await request(app)
      .post('/auth/register')
      .send({ email: 'lockout@example.com', password: 'strong-pass-123', language: 'en' })
      .expect(201);

    for (let i = 0; i < 4; i += 1) {
      await request(app)
        .post('/auth/login')
        .send({ email: 'lockout@example.com', password: 'wrong-password' })
        .expect(401);
    }

    await request(app)
      .post('/auth/login')
      .send({ email: 'lockout@example.com', password: 'wrong-password' })
      .expect(423);
  });
});
