import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env as defaultEnv, type EnvConfig } from '../config/env.js';
import { getRequestCorrelation, recordOperation } from '../services/observability.js';

const toMilliseconds = (startNs: bigint): number => {
  const durationNs = process.hrtime.bigint() - startNs;
  return Number(durationNs) / 1_000_000;
};

const sanitizePath = (url: string): string => {
  const [path] = url.split('?');
  return path || '/';
};

export const createRequestLogger =
  (config: Pick<EnvConfig, 'logHttpRequests'> = defaultEnv) =>
  (req: Request, res: Response, next: NextFunction): void => {
  const startedAt = process.hrtime.bigint();
  const requestId = req.get('x-request-id') ?? randomUUID();
  const path = sanitizePath(req.originalUrl);

  res.setHeader('x-request-id', requestId);
  res.on('finish', () => {
    const durationMs = Number(toMilliseconds(startedAt).toFixed(2));
    const correlation = getRequestCorrelation(req);
    recordOperation({
      operation: 'http.request',
      durationMs,
      error: res.statusCode >= 500,
      attributes: {
        method: req.method,
        path,
        statusCode: res.statusCode,
      },
    });

    if (!config.logHttpRequests) {
      return;
    }

    const log = {
      level: 'info',
      message: 'http_request',
      timestamp: new Date().toISOString(),
      requestId,
      method: req.method,
      path,
      statusCode: res.statusCode,
      durationMs,
      ip: req.ip,
      userAgent: req.get('user-agent') ?? null,
      sessionId: correlation.sessionId ?? null,
      streamId: correlation.streamId ?? null,
    };

    console.log(JSON.stringify(log));
  });

  next();
};

export const requestLogger = createRequestLogger();
