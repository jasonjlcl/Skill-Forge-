import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';

const sanitizePath = (url: string): string => {
  const [path] = url.split('?');
  return path || '/';
};

export const notFoundHandler = (_req: Request, res: Response): void => {
  res.status(404).json({ error: 'Not found' });
};

export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void => {
  void next;
  const message = err instanceof Error ? err.message : 'Internal server error';
  console.error(
    JSON.stringify({
      level: 'error',
      message: 'request_failed',
      timestamp: new Date().toISOString(),
      error: message,
      path: sanitizePath(_req.originalUrl),
      method: _req.method,
    }),
  );
  res.status(500).json({
    error: env.NODE_ENV === 'production' ? 'Internal server error' : message,
  });
};
