import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { AppOverrides } from '../src/app.js';
import type { QuizQuestionDraft } from '../src/domain/types.js';
import type { LlmClient } from '../src/services/gemini.js';
import { InMemoryVectorStore } from '../src/services/vectorStore.js';
import { InMemoryStore } from '../src/store/inMemoryStore.js';

const DAY_MS = 24 * 60 * 60 * 1000;

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
      DATA_RETENTION_DAYS: 30,
      dataRetentionDays: 30,
      RETENTION_JOB_AUTH_TOKEN: 'test-retention-token',
      retentionJobAuthToken: 'test-retention-token',
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

  it('exports authenticated user data for privacy governance', async () => {
    const { app, store } = buildTestApp();

    const register = await request(app)
      .post('/auth/register')
      .send({ email: 'export@example.com', password: 'strong-pass-123', language: 'en' })
      .expect(201);

    const userId = register.body.user.id as string;
    const setCookie = normalizeSetCookie(register.headers['set-cookie']);
    const cookieHeader = toCookieHeader(setCookie);

    const session = await store.createSession({
      userId,
      module: 'Safety Basics',
      id: randomUUID(),
    });
    await store.createMessage({
      sessionId: session.id,
      role: 'user',
      content: 'What should I check first?',
    });
    await store.createMessage({
      sessionId: session.id,
      role: 'assistant',
      content: 'Verify PPE before machine servicing.',
    });

    const attempt = await store.createQuizAttempt({
      userId,
      module: 'Safety Basics',
      totalQuestions: 1,
    });
    const question = await store.createQuizQuestion({
      attemptId: attempt.id,
      position: 1,
      prompt: 'What is the first step?',
      type: 'multiple_choice',
      options: ['A', 'B', 'C'],
      answerKey: 'A',
      explanation: 'Start with PPE checks.',
    });
    await store.createQuizAnswer({
      attemptId: attempt.id,
      questionId: question.id,
      userAnswer: 'A',
      isCorrect: true,
      explanation: 'Correct answer.',
    });
    await store.createPendingStreamRequest({
      id: randomUUID(),
      userId,
      request: {
        sessionId: session.id,
        message: 'Pending question',
      },
      expiresAt: new Date(Date.now() + DAY_MS),
    });

    const exported = await request(app).get('/privacy/export').set('Cookie', cookieHeader).expect(200);

    expect(exported.body.user.email).toBe('export@example.com');
    expect(exported.body.sessions).toHaveLength(1);
    expect(exported.body.sessions[0].messages).toHaveLength(2);
    expect(exported.body.quizAttempts).toHaveLength(1);
    expect(exported.body.quizAttempts[0].questions).toHaveLength(1);
    expect(exported.body.quizAttempts[0].answers).toHaveLength(1);
    expect(exported.body.pendingStreamRequests).toHaveLength(1);
  });

  it('runs retention purge for stale user data', async () => {
    const { app, store } = buildTestApp();

    const register = await request(app)
      .post('/auth/register')
      .send({ email: 'retention@example.com', password: 'strong-pass-123', language: 'en' })
      .expect(201);

    const userId = register.body.user.id as string;
    const setCookie = normalizeSetCookie(register.headers['set-cookie']);
    const cookieHeader = toCookieHeader(setCookie);
    const csrfToken = extractCookieValue(setCookie, 'csrf_token');
    expect(csrfToken).toBeTruthy();

    const staleSession = await store.createSession({
      userId,
      module: 'Old Module',
      id: randomUUID(),
    });
    staleSession.lastActiveAt = new Date(Date.now() - 45 * DAY_MS);
    await store.createMessage({
      sessionId: staleSession.id,
      role: 'user',
      content: 'Old session message',
    });

    const staleAttempt = await store.createQuizAttempt({
      userId,
      module: 'Old Module',
      totalQuestions: 1,
    });
    staleAttempt.startedAt = new Date(Date.now() - 45 * DAY_MS);
    const staleQuestion = await store.createQuizQuestion({
      attemptId: staleAttempt.id,
      position: 1,
      prompt: 'Old question',
      type: 'short_answer',
      options: null,
      answerKey: 'old',
      explanation: 'old',
    });
    await store.createQuizAnswer({
      attemptId: staleAttempt.id,
      questionId: staleQuestion.id,
      userAnswer: 'old',
      isCorrect: true,
      explanation: 'old',
    });
    await store.createPendingStreamRequest({
      id: randomUUID(),
      userId,
      request: {
        sessionId: staleSession.id,
        message: 'Expired pending message',
      },
      expiresAt: new Date(Date.now() - DAY_MS),
    });

    const retention = await request(app)
      .post('/privacy/retention/run')
      .set('Cookie', cookieHeader)
      .set('x-csrf-token', csrfToken as string)
      .send({ days: 30 })
      .expect(200);

    expect(retention.body.retentionDays).toBe(30);
    expect(retention.body.purged.sessionsDeleted).toBe(1);
    expect(retention.body.purged.messagesDeleted).toBe(1);
    expect(retention.body.purged.quizAttemptsDeleted).toBe(1);
    expect(retention.body.purged.quizQuestionsDeleted).toBe(1);
    expect(retention.body.purged.quizAnswersDeleted).toBe(1);
    expect(retention.body.purged.pendingStreamRequestsDeleted).toBe(1);
  });

  it('deletes account data when confirmed via privacy endpoint', async () => {
    const { app } = buildTestApp();

    const register = await request(app)
      .post('/auth/register')
      .send({ email: 'delete@example.com', password: 'strong-pass-123', language: 'en' })
      .expect(201);

    const setCookie = normalizeSetCookie(register.headers['set-cookie']);
    const cookieHeader = toCookieHeader(setCookie);
    const csrfToken = extractCookieValue(setCookie, 'csrf_token');
    expect(csrfToken).toBeTruthy();

    await request(app)
      .delete('/privacy')
      .set('Cookie', cookieHeader)
      .set('x-csrf-token', csrfToken as string)
      .send({ confirmEmail: 'delete@example.com' })
      .expect(204);

    await request(app).get('/auth/me').set('Cookie', cookieHeader).expect(401);
  });

  it('runs internal retention job with bearer token auth', async () => {
    const { app, store } = buildTestApp();

    const register = await request(app)
      .post('/auth/register')
      .send({ email: 'internal-retention@example.com', password: 'strong-pass-123', language: 'en' })
      .expect(201);
    const userId = register.body.user.id as string;

    const session = await store.createSession({
      userId,
      module: 'Old Module',
      id: randomUUID(),
    });
    session.lastActiveAt = new Date(Date.now() - 45 * DAY_MS);
    await store.createMessage({
      sessionId: session.id,
      role: 'user',
      content: 'Old session message',
    });

    const response = await request(app)
      .post('/api/internal/retention/run')
      .set('Authorization', 'Bearer test-retention-token')
      .send({ days: 30 })
      .expect(200);

    expect(response.body.retentionDays).toBe(30);
    expect(response.body.purged.sessionsDeleted).toBe(1);
    expect(response.body.purged.messagesDeleted).toBe(1);
  });

  it('rejects internal retention without bearer token', async () => {
    const { app } = buildTestApp();

    await request(app).post('/api/internal/retention/run').send({}).expect(401);
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
