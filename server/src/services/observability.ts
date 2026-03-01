import { performance } from 'node:perf_hooks';
import type { Request } from 'express';
import {
  metrics,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
  type Tracer,
} from '@opentelemetry/api';

const tracerName = 'skill_forge.api';
const tracerVersion = '1.0.0';
const tracer: Tracer = trace.getTracer(tracerName, tracerVersion);
const meter = metrics.getMeter(tracerName, tracerVersion);

const requestCounter = meter.createCounter('requests_total', {
  description: 'Total number of observed operations.',
});
const errorCounter = meter.createCounter('errors_total', {
  description: 'Total number of observed operation errors.',
});
const latencyHistogram = meter.createHistogram('latency_ms', {
  description: 'Observed operation latency in milliseconds.',
  unit: 'ms',
});
const tokenUsageCounter = meter.createCounter('token_usage_total', {
  description: 'Total number of generated/consumed model tokens.',
});
const streamStartedCounter = meter.createCounter('stream_started_total', {
  description: 'Number of chat streams started.',
});
const streamCompletedCounter = meter.createCounter('stream_completed_total', {
  description: 'Number of chat streams completed.',
});
const streamAbortedCounter = meter.createCounter('stream_aborted_total', {
  description: 'Number of chat streams aborted by disconnect/close.',
});

interface OperationAggregate {
  requests: number;
  errors: number;
  latencyMsTotal: number;
}

const operationAggregates = new Map<string, OperationAggregate>();
const tokenUsageByProvider = new Map<string, number>();
const telemetryEnabled = process.env.NODE_ENV !== 'test';
const summaryWindowMs = 60_000;

let summaryWindowStartedAt = Date.now();
let summaryTimer: NodeJS.Timeout | null = null;
let requestsTotal = 0;
let errorsTotal = 0;
let tokenUsageTotal = 0;
let streamsStarted = 0;
let streamsCompleted = 0;
let streamsAborted = 0;

const streamCompletionRateGauge = meter.createObservableGauge('stream_completion_rate', {
  description: 'Completed stream ratio over started streams.',
});
streamCompletionRateGauge.addCallback((observableResult) => {
  const completionRate = streamsStarted > 0 ? streamsCompleted / streamsStarted : 1;
  observableResult.observe(Number(completionRate.toFixed(4)));
});

const ensureSummaryTimer = (): void => {
  if (!telemetryEnabled || summaryTimer) {
    return;
  }

  summaryTimer = setTimeout(() => {
    flushObservabilitySummary();
  }, summaryWindowMs);
  summaryTimer.unref?.();
};

const flushObservabilitySummary = (): void => {
  if (!telemetryEnabled) {
    return;
  }

  const now = Date.now();
  const operations = [...operationAggregates.entries()].map(([operation, aggregate]) => ({
    operation,
    requests: aggregate.requests,
    errors: aggregate.errors,
    errorRate: aggregate.requests > 0 ? Number((aggregate.errors / aggregate.requests).toFixed(4)) : 0,
    avgLatencyMs:
      aggregate.requests > 0 ? Number((aggregate.latencyMsTotal / aggregate.requests).toFixed(2)) : 0,
  }));

  const streamCompletionRate = streamsStarted > 0 ? streamsCompleted / streamsStarted : 1;

  console.log(
    JSON.stringify({
      level: 'info',
      message: 'observability_summary',
      timestamp: new Date(now).toISOString(),
      windowStartedAt: new Date(summaryWindowStartedAt).toISOString(),
      windowMs: now - summaryWindowStartedAt,
      requestsTotal,
      errorsTotal,
      errorRate: requestsTotal > 0 ? Number((errorsTotal / requestsTotal).toFixed(4)) : 0,
      tokenUsageTotal,
      streams: {
        started: streamsStarted,
        completed: streamsCompleted,
        aborted: streamsAborted,
        completionRate: Number(streamCompletionRate.toFixed(4)),
      },
      operations,
      tokenUsageByProvider: [...tokenUsageByProvider.entries()].map(([provider, count]) => ({
        provider,
        tokens: count,
      })),
    }),
  );

  operationAggregates.clear();
  tokenUsageByProvider.clear();
  requestsTotal = 0;
  errorsTotal = 0;
  tokenUsageTotal = 0;
  streamsStarted = 0;
  streamsCompleted = 0;
  streamsAborted = 0;
  summaryWindowStartedAt = now;
  summaryTimer = null;
};

const getOperationAggregate = (operation: string): OperationAggregate => {
  const existing = operationAggregates.get(operation);
  if (existing) {
    return existing;
  }

  const created: OperationAggregate = {
    requests: 0,
    errors: 0,
    latencyMsTotal: 0,
  };
  operationAggregates.set(operation, created);
  return created;
};

const defaultAttributes = (operation: string, attributes?: Attributes): Attributes => ({
  operation,
  ...(attributes ?? {}),
});

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown error';

const attachError = (span: Span, error: unknown): void => {
  if (error instanceof Error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    return;
  }

  span.recordException({ name: 'Error', message: String(error) });
  span.setStatus({ code: SpanStatusCode.ERROR, message: 'Unknown error' });
};

export const recordOperation = (input: {
  operation: string;
  durationMs: number;
  error?: boolean;
  attributes?: Attributes;
}): void => {
  const attributes = defaultAttributes(input.operation, input.attributes);

  requestCounter.add(1, attributes);
  latencyHistogram.record(input.durationMs, attributes);

  requestsTotal += 1;
  const aggregate = getOperationAggregate(input.operation);
  aggregate.requests += 1;
  aggregate.latencyMsTotal += input.durationMs;

  if (input.error) {
    errorCounter.add(1, attributes);
    errorsTotal += 1;
    aggregate.errors += 1;
  }

  ensureSummaryTimer();
};

export const withObservedSpan = async <T>(
  input: {
    spanName: string;
    operation: string;
    attributes?: Attributes;
    metricAttributes?: Attributes;
  },
  run: () => Promise<T>,
): Promise<T> =>
  tracer.startActiveSpan(input.spanName, { attributes: input.attributes }, async (span) => {
    const startedAt = performance.now();
    try {
      const result = await run();
      span.setStatus({ code: SpanStatusCode.OK });
      recordOperation({
        operation: input.operation,
        durationMs: performance.now() - startedAt,
        attributes: input.metricAttributes ?? input.attributes,
      });
      return result;
    } catch (error) {
      attachError(span, error);
      recordOperation({
        operation: input.operation,
        durationMs: performance.now() - startedAt,
        error: true,
        attributes: {
          ...(input.metricAttributes ?? input.attributes ?? {}),
          error: errorMessage(error),
        },
      });
      throw error;
    } finally {
      span.end();
    }
  });

export const recordTokenUsage = (input: {
  tokens: number;
  provider: string;
  attributes?: Attributes;
}): void => {
  const safeTokens = Math.max(0, Math.floor(input.tokens));
  if (safeTokens <= 0) {
    return;
  }

  const attributes = {
    provider: input.provider,
    ...(input.attributes ?? {}),
  };
  tokenUsageCounter.add(safeTokens, attributes);
  tokenUsageTotal += safeTokens;
  tokenUsageByProvider.set(input.provider, (tokenUsageByProvider.get(input.provider) ?? 0) + safeTokens);
  ensureSummaryTimer();
};

export const recordStreamStarted = (attributes?: Attributes): void => {
  streamStartedCounter.add(1, attributes);
  streamsStarted += 1;
  ensureSummaryTimer();
};

export const recordStreamCompleted = (attributes?: Attributes): void => {
  streamCompletedCounter.add(1, attributes);
  streamsCompleted += 1;
  ensureSummaryTimer();
};

export const recordStreamAborted = (attributes?: Attributes): void => {
  streamAbortedCounter.add(1, attributes);
  streamsAborted += 1;
  ensureSummaryTimer();
};

export const estimateTextTokens = (text: string): number => {
  const compact = text.trim();
  if (!compact) {
    return 0;
  }
  return Math.max(1, Math.ceil(compact.length / 4));
};

export const setRequestCorrelation = (
  req: Request,
  correlationIds: Express.RequestCorrelationIds,
): void => {
  req.correlationIds = {
    ...(req.correlationIds ?? {}),
    ...correlationIds,
  };
};

export const getRequestCorrelation = (req: Request): Express.RequestCorrelationIds =>
  req.correlationIds ?? {};
