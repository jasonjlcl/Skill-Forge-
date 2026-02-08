import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../config/env.js';
import * as schema from './schema.js';

let db: NodePgDatabase<typeof schema> | null = null;
let pool: Pool | null = null;

const getConnectionString = (): string | null => env.DATABASE_URL ?? null;

const getOrCreatePool = (): Pool | null => {
  const connectionString = getConnectionString();
  if (!connectionString) {
    return null;
  }

  if (!pool) {
    pool = new Pool({ connectionString });
  }

  return pool;
};

export const getDb = (): NodePgDatabase<typeof schema> | null => {
  const activePool = getOrCreatePool();
  if (!activePool) {
    return null;
  }

  if (!db) {
    db = drizzle(activePool, { schema });
  }

  return db;
};

export const checkDatabaseHealth = async (): Promise<{
  configured: boolean;
  ok: boolean;
  latencyMs: number;
  error?: string;
}> => {
  const startedAt = Date.now();
  const activePool = getOrCreatePool();
  if (!activePool) {
    return {
      configured: false,
      ok: false,
      latencyMs: Date.now() - startedAt,
    };
  }

  try {
    await activePool.query('select 1');
    return {
      configured: true,
      ok: true,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'Unknown database error',
    };
  }
};

export const closeDatabase = async (): Promise<void> => {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = null;
  db = null;
};
