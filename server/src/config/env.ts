import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const MIN_PRODUCTION_SECRET_LENGTH = 32;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().optional(),
  POSTGRES_HOST: z.string().optional(),
  POSTGRES_PORT: z.coerce.number().optional(),
  POSTGRES_USER: z.string().optional(),
  POSTGRES_PASSWORD: z.string().optional(),
  POSTGRES_DB: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  EMBEDDING_PROVIDER: z.enum(['auto', 'openai', 'hash']).default('auto'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_BATCH_SIZE: z.coerce.number().default(64),
  JWT_SECRET: z.string().optional(),
  RATE_LIMIT_MAX: z.coerce.number().default(200),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(20),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().default(15),
  REQUEST_BODY_LIMIT: z.string().default('2mb'),
  CORS_ORIGIN: z.string().optional(),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  CHROMA_URL: z.string().optional(),
  CHROMA_COLLECTION: z.string().default('training_documents'),
  RAG_TOP_K: z.coerce.number().default(4),
  RAG_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.05),
  RAG_MAX_CONTEXT_CHARS: z.coerce.number().default(4000),
  RAG_REQUIRE_CONTEXT: z.enum(['true', 'false']).default('true'),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().default(600),
  LLM_TIMEOUT_MS: z.coerce.number().default(20000),
  RETRY_JITTER_RATIO: z.coerce.number().default(0.25),
  LLM_RETRY_MAX_ATTEMPTS: z.coerce.number().default(3),
  LLM_RETRY_BASE_DELAY_MS: z.coerce.number().default(250),
  LLM_RETRY_MAX_DELAY_MS: z.coerce.number().default(2000),
  LLM_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().default(5),
  LLM_CIRCUIT_OPEN_MS: z.coerce.number().default(30000),
  VECTOR_RETRY_MAX_ATTEMPTS: z.coerce.number().default(3),
  VECTOR_RETRY_BASE_DELAY_MS: z.coerce.number().default(250),
  VECTOR_RETRY_MAX_DELAY_MS: z.coerce.number().default(2000),
  VECTOR_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().default(5),
  VECTOR_CIRCUIT_OPEN_MS: z.coerce.number().default(30000),
  STREAM_REQUEST_TTL_SECONDS: z.coerce.number().default(120),
  DATA_RETENTION_DAYS: z.coerce.number().default(180),
  RETENTION_JOB_AUTH_TOKEN: z.string().optional(),
  RETENTION_JOB_OIDC_AUDIENCE: z.string().url().optional(),
  RETENTION_JOB_ALLOWED_SERVICE_ACCOUNTS: z.string().optional(),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().default(15000),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables', parsed.error.flatten().fieldErrors);
  throw new Error('Failed to parse environment variables');
}

const buildDatabaseUrl = (data: z.infer<typeof envSchema>): string | undefined => {
  if (data.DATABASE_URL) {
    return data.DATABASE_URL;
  }

  if (!data.POSTGRES_USER || !data.POSTGRES_PASSWORD || !data.POSTGRES_DB) {
    return undefined;
  }

  const host = data.POSTGRES_HOST ?? 'localhost';
  const port = data.POSTGRES_PORT ?? 5432;
  const username = encodeURIComponent(data.POSTGRES_USER);
  const password = encodeURIComponent(data.POSTGRES_PASSWORD);
  return `postgresql://${username}:${password}@${host}:${port}/${data.POSTGRES_DB}`;
};

const looksWeakSecret = (value: string): boolean =>
  value.length < MIN_PRODUCTION_SECRET_LENGTH || /change-me|dev-secret/i.test(value);

const resolveJwtSecret = (input: string | undefined, nodeEnv: z.infer<typeof envSchema>['NODE_ENV']): string => {
  if (nodeEnv === 'production') {
    if (!input) {
      throw new Error('JWT_SECRET is required in production');
    }
    if (looksWeakSecret(input)) {
      throw new Error(
        `JWT_SECRET must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters and not use placeholder values in production`,
      );
    }
    return input;
  }

  if (input && input.length >= 16) {
    return input;
  }

  return 'dev-secret-change-me';
};

const parsedData = parsed.data;
const builtDatabaseUrl = buildDatabaseUrl(parsedData);
const jwtSecret = resolveJwtSecret(parsedData.JWT_SECRET, parsedData.NODE_ENV);
const resolvedEmbeddingProvider =
  parsedData.EMBEDDING_PROVIDER === 'auto'
    ? parsedData.OPENAI_API_KEY
      ? 'openai'
      : 'hash'
    : parsedData.EMBEDDING_PROVIDER;

if (parsedData.NODE_ENV === 'production' && !builtDatabaseUrl) {
  throw new Error('DATABASE_URL (or POSTGRES_* variables) is required in production');
}

if (parsedData.NODE_ENV === 'production' && !parsedData.CHROMA_URL) {
  throw new Error('CHROMA_URL is required in production');
}

if (parsedData.NODE_ENV === 'production' && resolvedEmbeddingProvider !== 'openai') {
  throw new Error(
    'Semantic embeddings are required in production. Configure OPENAI_API_KEY or set EMBEDDING_PROVIDER=openai.',
  );
}

export const env = {
  ...parsedData,
  DATABASE_URL: builtDatabaseUrl,
  JWT_SECRET: jwtSecret,
  POSTGRES_HOST: parsedData.POSTGRES_HOST ?? 'localhost',
  POSTGRES_PORT: parsedData.POSTGRES_PORT ?? 5432,
  cookieSecure:
    parsedData.COOKIE_SECURE !== undefined
      ? parsedData.COOKIE_SECURE === 'true'
      : parsedData.NODE_ENV === 'production',
  ragTopK: Math.max(1, Math.floor(parsedData.RAG_TOP_K)),
  ragMinScore: parsedData.RAG_MIN_SCORE,
  ragMaxContextChars: Math.max(600, Math.floor(parsedData.RAG_MAX_CONTEXT_CHARS)),
  ragRequireContext: parsedData.RAG_REQUIRE_CONTEXT === 'true',
  llmMaxOutputTokens: Math.max(64, Math.floor(parsedData.LLM_MAX_OUTPUT_TOKENS)),
  llmTimeoutMs: Math.max(1000, Math.floor(parsedData.LLM_TIMEOUT_MS)),
  retryJitterRatio: Math.max(0, Math.min(1, parsedData.RETRY_JITTER_RATIO)),
  llmRetryMaxAttempts: Math.max(1, Math.floor(parsedData.LLM_RETRY_MAX_ATTEMPTS)),
  llmRetryBaseDelayMs: Math.max(0, Math.floor(parsedData.LLM_RETRY_BASE_DELAY_MS)),
  llmRetryMaxDelayMs: Math.max(
    Math.max(0, Math.floor(parsedData.LLM_RETRY_BASE_DELAY_MS)),
    Math.floor(parsedData.LLM_RETRY_MAX_DELAY_MS),
  ),
  llmCircuitFailureThreshold: Math.max(1, Math.floor(parsedData.LLM_CIRCUIT_FAILURE_THRESHOLD)),
  llmCircuitOpenMs: Math.max(1000, Math.floor(parsedData.LLM_CIRCUIT_OPEN_MS)),
  vectorRetryMaxAttempts: Math.max(1, Math.floor(parsedData.VECTOR_RETRY_MAX_ATTEMPTS)),
  vectorRetryBaseDelayMs: Math.max(0, Math.floor(parsedData.VECTOR_RETRY_BASE_DELAY_MS)),
  vectorRetryMaxDelayMs: Math.max(
    Math.max(0, Math.floor(parsedData.VECTOR_RETRY_BASE_DELAY_MS)),
    Math.floor(parsedData.VECTOR_RETRY_MAX_DELAY_MS),
  ),
  vectorCircuitFailureThreshold: Math.max(1, Math.floor(parsedData.VECTOR_CIRCUIT_FAILURE_THRESHOLD)),
  vectorCircuitOpenMs: Math.max(1000, Math.floor(parsedData.VECTOR_CIRCUIT_OPEN_MS)),
  authRateLimitMax: Math.max(1, Math.floor(parsedData.AUTH_RATE_LIMIT_MAX)),
  loginMaxAttempts: Math.max(1, Math.floor(parsedData.LOGIN_MAX_ATTEMPTS)),
  loginLockoutMinutes: Math.max(1, Math.floor(parsedData.LOGIN_LOCKOUT_MINUTES)),
  streamRequestTtlSeconds: Math.max(10, Math.floor(parsedData.STREAM_REQUEST_TTL_SECONDS)),
  dataRetentionDays: Math.max(1, Math.floor(parsedData.DATA_RETENTION_DAYS)),
  retentionJobAuthToken: parsedData.RETENTION_JOB_AUTH_TOKEN,
  retentionJobOidcAudience: parsedData.RETENTION_JOB_OIDC_AUDIENCE,
  retentionJobAllowedServiceAccounts: (parsedData.RETENTION_JOB_ALLOWED_SERVICE_ACCOUNTS ?? '')
    .split(',')
    .map((account) => account.trim().toLowerCase())
    .filter(Boolean),
  embeddingProvider: resolvedEmbeddingProvider,
  openaiEmbeddingModel: parsedData.OPENAI_EMBEDDING_MODEL,
  embeddingBatchSize: Math.max(1, Math.floor(parsedData.EMBEDDING_BATCH_SIZE)),
  corsOrigins: (parsedData.CORS_ORIGIN ?? parsedData.CLIENT_URL)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
};

export type EnvConfig = typeof env;
