import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

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
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters').default('dev-secret-change-me'),
  RATE_LIMIT_MAX: z.coerce.number().default(200),
  REQUEST_BODY_LIMIT: z.string().default('2mb'),
  CORS_ORIGIN: z.string().optional(),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  CHROMA_URL: z.string().optional(),
  CHROMA_COLLECTION: z.string().default('training_documents'),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().default(15000),
  COOKIE_SECURE: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((value) => value === 'true'),
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

export const env = {
  ...parsed.data,
  DATABASE_URL: buildDatabaseUrl(parsed.data),
  POSTGRES_HOST: parsed.data.POSTGRES_HOST ?? 'localhost',
  POSTGRES_PORT: parsed.data.POSTGRES_PORT ?? 5432,
  cookieSecure: parsed.data.COOKIE_SECURE ?? parsed.data.NODE_ENV === 'production',
  corsOrigins: (parsed.data.CORS_ORIGIN ?? parsed.data.CLIENT_URL)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
};

export type EnvConfig = typeof env;
