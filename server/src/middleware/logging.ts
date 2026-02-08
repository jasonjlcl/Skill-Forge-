import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const toMilliseconds = (startNs: bigint): number => {
  const durationNs = process.hrtime.bigint() - startNs;
  return Number(durationNs) / 1_000_000;
};

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startedAt = process.hrtime.bigint();
  const requestId = req.get('x-request-id') ?? randomUUID();

  res.setHeader('x-request-id', requestId);
  res.on('finish', () => {
    const log = {
      level: 'info',
      message: 'http_request',
      timestamp: new Date().toISOString(),
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Number(toMilliseconds(startedAt).toFixed(2)),
      ip: req.ip,
      userAgent: req.get('user-agent') ?? null,
    };

    console.log(JSON.stringify(log));
  });

  next();
};
