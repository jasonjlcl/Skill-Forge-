import { randomBytes } from 'node:crypto';
import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';

export const CSRF_COOKIE_NAME = 'csrf_token';
export const CSRF_HEADER_NAME = 'x-csrf-token';

const csrfCookieOptions = (secure = env.cookieSecure): CookieOptions => ({
  httpOnly: false,
  sameSite: 'strict',
  secure,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
});

export const issueCsrfCookie = (res: Response, secure = env.cookieSecure): string => {
  const token = randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE_NAME, token, csrfCookieOptions(secure));
  return token;
};

export const clearCsrfCookie = (res: Response, secure = env.cookieSecure): void => {
  const { maxAge, ...clearOptions } = csrfCookieOptions(secure);
  void maxAge;
  res.clearCookie(CSRF_COOKIE_NAME, clearOptions);
};

export const ensureCsrfCookie = (req: Request, res: Response, secure = env.cookieSecure): string => {
  const existing = req.cookies?.[CSRF_COOKIE_NAME];
  if (typeof existing === 'string' && existing.length >= 32) {
    return existing;
  }

  return issueCsrfCookie(res, secure);
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const requireCsrf = (req: Request, res: Response, next: NextFunction): void => {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.get(CSRF_HEADER_NAME);
  if (
    typeof cookieToken !== 'string' ||
    !cookieToken ||
    typeof headerToken !== 'string' ||
    !headerToken ||
    cookieToken !== headerToken
  ) {
    res.status(403).json({ error: 'Invalid CSRF token' });
    return;
  }

  next();
};
