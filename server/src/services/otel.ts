import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleMetricExporter, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { env } from '../config/env.js';

type OtlpHeaders = Record<string, string>;

let sdk: NodeSDK | null = null;
let initialized = false;

const parseOtlpHeaders = (raw: string | undefined): OtlpHeaders | undefined => {
  if (!raw) {
    return undefined;
  }

  const headers: OtlpHeaders = {};
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!key || !value) {
      continue;
    }

    headers[key] = value;
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
};

const appendEndpointPath = (baseUrl: string, path: string): string => {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/v1/traces') || trimmed.endsWith('/v1/metrics')) {
    return trimmed;
  }
  return `${trimmed}/${path}`;
};

const resolveTraceEndpoint = (): string | undefined => {
  if (env.otelExporterOtlpTracesEndpoint) {
    return env.otelExporterOtlpTracesEndpoint;
  }
  if (env.otelExporterOtlpEndpoint) {
    return appendEndpointPath(env.otelExporterOtlpEndpoint, 'v1/traces');
  }
  return undefined;
};

const resolveMetricEndpoint = (): string | undefined => {
  if (env.otelExporterOtlpMetricsEndpoint) {
    return env.otelExporterOtlpMetricsEndpoint;
  }
  if (env.otelExporterOtlpEndpoint) {
    return appendEndpointPath(env.otelExporterOtlpEndpoint, 'v1/metrics');
  }
  return undefined;
};

const telemetryEnabled = (): boolean => env.NODE_ENV !== 'test' && env.otelExporterMode !== 'none';

export const initializeTelemetry = async (): Promise<void> => {
  if (initialized || !telemetryEnabled()) {
    return;
  }

  const headers = parseOtlpHeaders(env.otelExporterOtlpHeaders);
  const traceEndpoint = resolveTraceEndpoint();
  const metricEndpoint = resolveMetricEndpoint();

  try {
    const traceExporter =
      env.otelExporterMode === 'console'
        ? new ConsoleSpanExporter()
        : new OTLPTraceExporter({
            headers,
            ...(traceEndpoint ? { url: traceEndpoint } : {}),
          });

    const metricExporter =
      env.otelExporterMode === 'console'
        ? new ConsoleMetricExporter()
        : new OTLPMetricExporter({
            headers,
            ...(metricEndpoint ? { url: metricEndpoint } : {}),
          });

    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: env.otelMetricExportIntervalMs,
      exportTimeoutMillis: env.otelMetricExportTimeoutMs,
    });

    sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: env.otelServiceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: env.otelServiceVersion ?? '0.1.0',
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: env.NODE_ENV,
      }),
      traceExporter,
      metricReader,
    });

    await sdk.start();
    initialized = true;

    console.log(
      JSON.stringify({
        level: 'info',
        message: 'telemetry_exporter_started',
        timestamp: new Date().toISOString(),
        mode: env.otelExporterMode,
        traceEndpoint: traceEndpoint ?? '(default)',
        metricEndpoint: metricEndpoint ?? '(default)',
        metricExportIntervalMs: env.otelMetricExportIntervalMs,
      }),
    );
  } catch (error) {
    sdk = null;
    initialized = false;
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'telemetry_exporter_start_failed',
        timestamp: new Date().toISOString(),
        mode: env.otelExporterMode,
        error: error instanceof Error ? error.message : 'Unknown telemetry exporter startup error',
      }),
    );
  }
};

export const shutdownTelemetry = async (): Promise<void> => {
  if (!sdk) {
    return;
  }

  try {
    await sdk.shutdown();
    console.log(
      JSON.stringify({
        level: 'info',
        message: 'telemetry_exporter_stopped',
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'telemetry_exporter_stop_failed',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown telemetry exporter shutdown error',
      }),
    );
  } finally {
    sdk = null;
    initialized = false;
  }
};
