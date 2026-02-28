import request from 'supertest';
import { createApp, type AppOverrides } from '../src/app.js';
import type { QuizQuestionDraft } from '../src/domain/types.js';
import type { LlmClient } from '../src/services/gemini.js';
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

const parseSseEvents = (raw: string): Array<{ event: string; data: unknown }> => {
  return raw
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((line) => line.startsWith('event: '))?.slice('event: '.length) ?? '';
      const dataText = lines.find((line) => line.startsWith('data: '))?.slice('data: '.length) ?? 'null';

      let data: unknown = null;
      try {
        data = JSON.parse(dataText);
      } catch {
        data = dataText;
      }

      return { event, data };
    });
};

const buildTestApp = () => {
  const store = new InMemoryStore();
  const queryMock = jest.fn(async () => [
    {
      id: 'chunk-1',
      module: 'Safety Basics',
      source: 'docs/safety.md',
      text: 'Wear PPE and verify lockout-tagout before machine servicing.',
      score: 0.88,
      metadata: {},
    },
  ]);
  const vectorStore = {
    upsert: async () => {},
    query: queryMock,
  };

  const generateAssistanceMock = jest.fn(async () => ({
    answer: '1) Verify PPE first [S1]\n2) Apply lockout-tagout before servicing [S1]\nWhy: These steps reduce operator risk [S1]',
  }));

  const llm: LlmClient = {
    generateAssistance: generateAssistanceMock,
    generateQuiz: async (): Promise<QuizQuestionDraft[]> => [],
    explainWhy: async () => 'Reasoning based on SOP context.',
  };

  const overrides: AppOverrides = {
    store,
    llm,
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
      authRateLimitMax: 1000,
      loginMaxAttempts: 5,
      loginLockoutMinutes: 15,
      REQUEST_BODY_LIMIT: '2mb',
      CLIENT_URL: 'http://localhost:5173',
      CHROMA_URL: undefined,
      CHROMA_COLLECTION: 'test_collection',
      COOKIE_SECURE: 'false',
      cookieSecure: false,
      ragTopK: 3,
      ragMinScore: 0.2,
      ragMaxContextChars: 1500,
      ragRequireContext: true,
      streamRequestTtlSeconds: 120,
    },
  };

  return {
    app: createApp(overrides),
    queryMock,
    generateAssistanceMock,
  };
};

describe('chat stream', () => {
  it('streams retrieval-grounded responses with meta/token/done events', async () => {
    const { app, queryMock, generateAssistanceMock } = buildTestApp();

    const register = await request(app)
      .post('/auth/register')
      .send({ email: 'stream@example.com', password: 'strong-pass-123', language: 'en' })
      .expect(201);

    const setCookie = normalizeSetCookie(register.headers['set-cookie']);
    const cookieHeader = toCookieHeader(setCookie);
    const csrfToken = extractCookieValue(setCookie, 'csrf_token');
    expect(csrfToken).toBeTruthy();

    const streamStart = await request(app)
      .post('/chat/stream/start')
      .set('Cookie', cookieHeader)
      .set('x-csrf-token', csrfToken as string)
      .send({
        message: 'What should I do before servicing a machine?',
        module: 'Safety Basics',
        topK: 6,
        timeSeconds: 21,
      })
      .expect(201);

    const response = await request(app)
      .get('/chat/stream')
      .query({ stream_id: streamStart.body.streamId })
      .set('Cookie', cookieHeader)
      .expect(200);

    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(queryMock).toHaveBeenCalledWith({
      query: 'What should I do before servicing a machine?',
      topK: 6,
      minScore: 0.2,
      module: 'Safety Basics',
    });
    expect(generateAssistanceMock).toHaveBeenCalledTimes(1);

    const streamBody = response.text ?? '';
    const events = parseSseEvents(streamBody);
    expect(events.some((entry) => entry.event === 'meta')).toBe(true);
    expect(events.some((entry) => entry.event === 'token')).toBe(true);
    expect(events.some((entry) => entry.event === 'done')).toBe(true);

    const meta = events.find((entry) => entry.event === 'meta')?.data as
      | {
          sessionId: string;
          module: string;
          sources: Array<{ id: string; source: string; score: number; excerpt?: string }>;
        }
      | undefined;
    expect(meta?.module).toBe('Safety Basics');
    expect(meta?.sources[0]?.source).toBe('docs/safety.md');
    expect(meta?.sources[0]?.excerpt).toContain('lockout-tagout');
  });
});
