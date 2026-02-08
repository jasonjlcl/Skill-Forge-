import { env } from '../config/env.js';
import { checkDatabaseHealth } from '../db/index.js';

interface DependencyHealth {
  configured: boolean;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface HealthSnapshot {
  status: 'ok' | 'degraded';
  timestamp: string;
  dependencies: {
    database: DependencyHealth;
    chroma: DependencyHealth;
  };
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const checkChromaHealth = async (): Promise<DependencyHealth> => {
  const startedAt = Date.now();
  if (!env.CHROMA_URL) {
    return {
      configured: false,
      ok: false,
      latencyMs: Date.now() - startedAt,
    };
  }

  try {
    const response = await withTimeout(
      fetch(`${env.CHROMA_URL.replace(/\/+$/, '')}/api/v1/heartbeat`),
      3000,
    );

    if (!response.ok) {
      return {
        configured: true,
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: `Unexpected status ${response.status}`,
      };
    }

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
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

export const getHealthSnapshot = async (): Promise<HealthSnapshot> => {
  const [database, chroma] = await Promise.all([checkDatabaseHealth(), checkChromaHealth()]);

  const configuredChecks = [database, chroma].filter((dependency) => dependency.configured);
  const status =
    configuredChecks.length === 0 || configuredChecks.every((dependency) => dependency.ok)
      ? 'ok'
      : 'degraded';

  return {
    status,
    timestamp: new Date().toISOString(),
    dependencies: {
      database,
      chroma,
    },
  };
};
