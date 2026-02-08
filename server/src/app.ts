import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors, { type CorsOptions } from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { env as defaultEnv, type EnvConfig } from './config/env.js';
import type { AppDeps } from './domain/deps.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { requestLogger } from './middleware/logging.js';
import { createAuthRouter } from './routes/auth.js';
import { createChatRouter } from './routes/chat.js';
import { createMeRouter } from './routes/me.js';
import { createQuizRouter } from './routes/quiz.js';
import { getHealthSnapshot } from './services/health.js';
import { getLlmClient, type LlmClient } from './services/gemini.js';
import { getVectorStore, type VectorStore } from './services/vectorStore.js';
import { getStore, type DataStore } from './store/index.js';

const parseOrigins = (raw: string): string[] =>
  raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const resolveEnv = (overrides?: Partial<EnvConfig>): EnvConfig => {
  const merged = {
    ...defaultEnv,
    ...(overrides ?? {}),
  } as EnvConfig;

  return {
    ...merged,
    corsOrigins:
      overrides?.corsOrigins && overrides.corsOrigins.length > 0
        ? overrides.corsOrigins
        : overrides?.CORS_ORIGIN
          ? parseOrigins(overrides.CORS_ORIGIN)
          : overrides?.CLIENT_URL
            ? parseOrigins(overrides.CLIENT_URL)
          : defaultEnv.corsOrigins,
    cookieSecure:
      overrides?.cookieSecure ??
      (overrides?.COOKIE_SECURE ?? merged.cookieSecure),
  };
};

const isSsePath = (path: string): boolean =>
  path.endsWith('/chat/stream') || path.endsWith('/sse/chat/stream');

export interface AppOverrides {
  env?: Partial<EnvConfig>;
  store?: DataStore;
  llm?: LlmClient;
  vectorStore?: VectorStore;
}

export const createApp = (overrides: AppOverrides = {}) => {
  const env = resolveEnv(overrides.env);
  const store = overrides.store ?? getStore();
  const llm = overrides.llm ?? getLlmClient();
  const vectorStore = overrides.vectorStore ?? getVectorStore();

  const deps: AppDeps = { env, store, llm, vectorStore };
  const app = express();

  if (env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  const corsOptions: CorsOptions = {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      callback(null, env.corsOrigins.includes(origin));
    },
    credentials: true,
  };

  app.use(requestLogger);
  app.use(cors(corsOptions));
  app.use(
    helmet({
      contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(
    compression({
      filter: (req, res) => {
        if (isSsePath(req.path)) {
          return false;
        }
        return compression.filter(req, res);
      },
    }),
  );
  app.use(express.json({ limit: env.REQUEST_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: env.REQUEST_BODY_LIMIT }));
  app.use(cookieParser());

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/health', async (_req, res) => {
    const health = await getHealthSnapshot();
    res.status(health.status === 'ok' ? 200 : 503).json(health);
  });

  const authRouter = createAuthRouter(deps);
  const chatRouter = createChatRouter(deps);
  const quizRouter = createQuizRouter(deps);
  const meRouter = createMeRouter(deps);

  app.use('/auth', authRouter);
  app.use('/chat', chatRouter);
  app.use('/quiz', quizRouter);
  app.use('/me', meRouter);

  app.use('/api/auth', authRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/quiz', quizRouter);
  app.use('/api/me', meRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
