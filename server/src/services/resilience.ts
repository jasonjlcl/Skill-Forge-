const TRANSIENT_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETRESET',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const TRANSIENT_MESSAGE_PATTERN =
  /timeout|timed out|temporar|rate limit|too many requests|service unavailable|gateway|overloaded|network error|socket hang up|connection reset|connection refused/i;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const readStatusCode = (error: unknown): number | undefined => {
  const record = asRecord(error);
  if (!record) {
    return undefined;
  }

  const response = asRecord(record.response);
  const cause = asRecord(record.cause);

  return (
    asNumber(record.status) ??
    asNumber(record.statusCode) ??
    asNumber(response?.status) ??
    asNumber(cause?.status) ??
    asNumber(cause?.statusCode)
  );
};

const readErrorCode = (error: unknown): string | undefined => {
  const record = asRecord(error);
  if (!record) {
    return undefined;
  }

  const response = asRecord(record.response);
  const cause = asRecord(record.cause);

  return (
    asString(record.code) ??
    asString(record.errno) ??
    asString(response?.code) ??
    asString(cause?.code)
  );
};

const wait = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

interface ResilienceCounters {
  requests: number;
  successes: number;
  failures: number;
  retries: number;
  circuitOpenings: number;
  shortCircuits: number;
}

const RESILIENCE_TELEMETRY_WINDOW_MS = 60_000;
const RESILIENCE_TELEMETRY_EVENT_FLUSH_THRESHOLD = 100;
const telemetryEnabled = process.env.NODE_ENV !== 'test';
const resilienceCounters = new Map<string, ResilienceCounters>();
let telemetryWindowStartedAt = Date.now();
let telemetryFlushTimer: NodeJS.Timeout | null = null;
let telemetryEventCount = 0;

const getCounters = (dependency: string): ResilienceCounters => {
  const existing = resilienceCounters.get(dependency);
  if (existing) {
    return existing;
  }

  const created: ResilienceCounters = {
    requests: 0,
    successes: 0,
    failures: 0,
    retries: 0,
    circuitOpenings: 0,
    shortCircuits: 0,
  };
  resilienceCounters.set(dependency, created);
  return created;
};

const scheduleTelemetryFlush = (): void => {
  if (!telemetryEnabled || telemetryFlushTimer) {
    return;
  }

  telemetryFlushTimer = setTimeout(() => {
    flushResilienceTelemetry();
  }, RESILIENCE_TELEMETRY_WINDOW_MS);
  telemetryFlushTimer.unref?.();
};

const flushResilienceTelemetry = (): void => {
  if (!telemetryEnabled) {
    return;
  }

  const now = Date.now();
  if (resilienceCounters.size === 0) {
    telemetryWindowStartedAt = now;
    telemetryEventCount = 0;
    telemetryFlushTimer = null;
    return;
  }

  const dependencies = [...resilienceCounters.entries()].map(([dependency, counters]) => ({
    dependency,
    ...counters,
  }));

  console.log(
    JSON.stringify({
      level: 'info',
      message: 'resilience_summary',
      timestamp: new Date(now).toISOString(),
      windowStartedAt: new Date(telemetryWindowStartedAt).toISOString(),
      windowMs: now - telemetryWindowStartedAt,
      dependencies,
    }),
  );

  resilienceCounters.clear();
  telemetryEventCount = 0;
  telemetryWindowStartedAt = now;
  telemetryFlushTimer = null;
};

const recordTelemetry = (dependency: string, field: keyof ResilienceCounters, delta: number = 1): void => {
  if (!telemetryEnabled) {
    return;
  }

  const counters = getCounters(dependency);
  counters[field] += delta;
  telemetryEventCount += delta;

  if (telemetryEventCount >= RESILIENCE_TELEMETRY_EVENT_FLUSH_THRESHOLD) {
    if (telemetryFlushTimer) {
      clearTimeout(telemetryFlushTimer);
      telemetryFlushTimer = null;
    }
    flushResilienceTelemetry();
    return;
  }

  scheduleTelemetryFlush();
};

const logCircuitOpened = (input: {
  dependency: string;
  failureThreshold: number;
  openMs: number;
  openUntil: number;
}): void => {
  if (!telemetryEnabled) {
    return;
  }

  console.warn(
    JSON.stringify({
      level: 'warn',
      message: 'resilience_circuit_opened',
      timestamp: new Date().toISOString(),
      dependency: input.dependency,
      failureThreshold: input.failureThreshold,
      openMs: input.openMs,
      openUntil: new Date(input.openUntil).toISOString(),
    }),
  );
};

export interface RetryAttempt {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: unknown;
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio?: number;
  isRetryable?: (error: unknown) => boolean;
  onRetry?: (attempt: RetryAttempt) => void;
}

export const isTransientUpstreamError = (error: unknown): boolean => {
  if (error instanceof CircuitOpenError) {
    return false;
  }

  const statusCode = readStatusCode(error);
  if (statusCode && (TRANSIENT_STATUS_CODES.has(statusCode) || statusCode >= 500)) {
    return true;
  }

  const code = readErrorCode(error)?.toUpperCase();
  if (code && TRANSIENT_ERROR_CODES.has(code)) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_MESSAGE_PATTERN.test(message);
};

export const withRetry = async <T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> => {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts));
  const baseDelayMs = Math.max(0, Math.floor(options.baseDelayMs));
  const maxDelayMs = Math.max(baseDelayMs, Math.floor(options.maxDelayMs));
  const jitterRatio = Math.max(0, Math.min(1, options.jitterRatio ?? 0));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const canRetry = (options.isRetryable ?? (() => true))(error);
      if (!canRetry || attempt >= maxAttempts) {
        throw error;
      }

      const baseDelayForAttempt = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitterWindow = Math.floor(baseDelayForAttempt * jitterRatio);
      const jitter = jitterWindow > 0 ? Math.floor(Math.random() * (jitterWindow + 1)) : 0;
      const delayMs = baseDelayForAttempt + jitter;

      options.onRetry?.({
        attempt,
        maxAttempts,
        delayMs,
        error,
      });

      if (delayMs > 0) {
        await wait(delayMs);
      }
    }
  }

  throw new Error('Retry policy exhausted without result.');
};

export class CircuitOpenError extends Error {
  readonly dependency: string;
  readonly openUntil: number;

  constructor(dependency: string, openUntil: number) {
    super(`Circuit for ${dependency} is open until ${new Date(openUntil).toISOString()}`);
    this.name = 'CircuitOpenError';
    this.dependency = dependency;
    this.openUntil = openUntil;
  }
}

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold: number;
  openMs: number;
  shouldRecordFailure?: (error: unknown) => boolean;
}

interface ExecuteCircuitOptions {
  shouldRecordFailure?: (error: unknown) => boolean;
}

export class CircuitBreaker {
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly openMs: number;
  private readonly shouldRecordFailure: (error: unknown) => boolean;
  private failures = 0;
  private openUntil = 0;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = Math.max(1, Math.floor(options.failureThreshold));
    this.openMs = Math.max(1, Math.floor(options.openMs));
    this.shouldRecordFailure = options.shouldRecordFailure ?? (() => true);
  }

  async execute<T>(operation: () => Promise<T>, options?: ExecuteCircuitOptions): Promise<T> {
    recordTelemetry(this.name, 'requests');

    if (this.isOpen()) {
      recordTelemetry(this.name, 'shortCircuits');
      throw new CircuitOpenError(this.name, this.openUntil);
    }

    try {
      const result = await operation();
      recordTelemetry(this.name, 'successes');
      this.failures = 0;
      return result;
    } catch (error) {
      const shouldRecordFailure = options?.shouldRecordFailure ?? this.shouldRecordFailure;
      if (shouldRecordFailure(error)) {
        recordTelemetry(this.name, 'failures');
        this.failures += 1;
        if (this.failures >= this.failureThreshold) {
          this.failures = 0;
          this.openUntil = Date.now() + this.openMs;
          recordTelemetry(this.name, 'circuitOpenings');
          logCircuitOpened({
            dependency: this.name,
            failureThreshold: this.failureThreshold,
            openMs: this.openMs,
            openUntil: this.openUntil,
          });
        }
      }
      throw error;
    }
  }

  isOpen(): boolean {
    return this.openUntil > Date.now();
  }

  snapshot(): {
    name: string;
    openUntil: number;
    isOpen: boolean;
    failureCount: number;
  } {
    return {
      name: this.name,
      openUntil: this.openUntil,
      isOpen: this.isOpen(),
      failureCount: this.failures,
    };
  }
}

export interface ResilienceExecutionOptions {
  circuitBreaker: CircuitBreaker;
  retry: RetryOptions;
  shouldRecordFailure?: (error: unknown) => boolean;
}

export const executeWithResilience = async <T>(
  operation: () => Promise<T>,
  options: ResilienceExecutionOptions,
): Promise<T> => {
  const dependency = options.circuitBreaker.snapshot().name;
  const retryOptions: RetryOptions = {
    ...options.retry,
    onRetry: (attempt) => {
      recordTelemetry(dependency, 'retries');
      options.retry.onRetry?.(attempt);
    },
  };

  return options.circuitBreaker.execute(() => withRetry(operation, retryOptions), {
    shouldRecordFailure: options.shouldRecordFailure ?? options.retry.isRetryable,
  });
};
