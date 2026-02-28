import bcrypt from 'bcrypt';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { AppDeps } from '../domain/deps.js';
import type { SkillLevel } from '../domain/types.js';
import { requireAuth } from '../middleware/auth.js';
import { wrapAsync } from '../middleware/async.js';
import { clearCsrfCookie, ensureCsrfCookie, issueCsrfCookie, requireCsrf } from '../middleware/csrf.js';
import { normalizeLanguage } from '../services/language.js';
import { signAuthToken } from '../services/jwt.js';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  language: z.string().optional(),
  skillLevel: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const toUserPayload = (user: {
  id: string;
  email: string;
  language: string;
  skillLevel: SkillLevel;
  createdAt: Date;
}) => ({
  id: user.id,
  email: user.email,
  language: user.language,
  skillLevel: user.skillLevel,
  createdAt: user.createdAt.toISOString(),
});

export const createAuthRouter = (deps: AppDeps): Router => {
  const router = Router();

  const authCookieOptions = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: deps.env.cookieSecure,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  };
  const { maxAge: authCookieMaxAge, ...authClearCookieOptions } = authCookieOptions;
  void authCookieMaxAge;

  const createAuthRateLimiter = (max: number) =>
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => {
        const email =
          typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : 'no-email';
        return `${req.ip}:${email}`;
      },
    });

  const registerRateLimit = createAuthRateLimiter(deps.env.authRateLimitMax);
  const loginRateLimit = createAuthRateLimiter(deps.env.authRateLimitMax);

  const lockoutMs = deps.env.loginLockoutMinutes * 60 * 1000;

  const isAccountLocked = (lockedUntil: Date | null): boolean =>
    Boolean(lockedUntil && lockedUntil.getTime() > Date.now());

  const lockoutResponse = {
    error: `Account temporarily locked. Try again in ${deps.env.loginLockoutMinutes} minute(s).`,
  };

  router.post(
    '/register',
    registerRateLimit,
    wrapAsync(async (req, res) => {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
        return;
      }

      const { email, password, language, skillLevel } = parsed.data;
      const normalizedEmail = email.trim().toLowerCase();
      const existing = await deps.store.findUserByEmail(normalizedEmail);
      if (existing) {
        res.status(409).json({ error: 'Email is already registered' });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const user = await deps.store.createUser({
        email: normalizedEmail,
        passwordHash,
        language: normalizeLanguage(language),
        skillLevel: skillLevel ?? 'beginner',
      });

      const token = signAuthToken({ userId: user.id, email: user.email, tokenVersion: user.tokenVersion });
      res.cookie('auth_token', token, authCookieOptions);
      issueCsrfCookie(res, deps.env.cookieSecure);
      res.status(201).json({ user: toUserPayload(user) });
    }),
  );

  router.post(
    '/login',
    loginRateLimit,
    wrapAsync(async (req, res) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
        return;
      }

      const { email, password } = parsed.data;
      const normalizedEmail = email.trim().toLowerCase();
      const user = await deps.store.findUserByEmail(normalizedEmail);
      if (!user) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      if (isAccountLocked(user.lockedUntil)) {
        res.status(423).json(lockoutResponse);
        return;
      }

      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        const nextAttempts = user.failedLoginAttempts + 1;
        if (nextAttempts >= deps.env.loginMaxAttempts) {
          await deps.store.updateUser(user.id, {
            failedLoginAttempts: 0,
            lockedUntil: new Date(Date.now() + lockoutMs),
          });
          res.status(423).json(lockoutResponse);
          return;
        }

        await deps.store.updateUser(user.id, {
          failedLoginAttempts: nextAttempts,
        });
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const updatedUser =
        (await deps.store.updateUser(user.id, {
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
        })) ?? user;

      const token = signAuthToken({
        userId: updatedUser.id,
        email: updatedUser.email,
        tokenVersion: updatedUser.tokenVersion,
      });
      res.cookie('auth_token', token, authCookieOptions);
      issueCsrfCookie(res, deps.env.cookieSecure);
      res.json({ user: toUserPayload(updatedUser) });
    }),
  );

  router.post(
    '/logout',
    requireAuth(deps.store),
    requireCsrf,
    wrapAsync(async (req, res) => {
      await deps.store.updateUser(req.user.id, {
        tokenVersion: req.user.tokenVersion + 1,
      });
      res.clearCookie('auth_token', authClearCookieOptions);
      clearCsrfCookie(res, deps.env.cookieSecure);
      res.status(204).send();
    }),
  );

  router.post(
    '/sessions/revoke',
    requireAuth(deps.store),
    requireCsrf,
    wrapAsync(async (req, res) => {
      await deps.store.updateUser(req.user.id, {
        tokenVersion: req.user.tokenVersion + 1,
      });
      res.clearCookie('auth_token', authClearCookieOptions);
      clearCsrfCookie(res, deps.env.cookieSecure);
      res.status(204).send();
    }),
  );

  router.get(
    '/me',
    requireAuth(deps.store),
    wrapAsync(async (req, res) => {
      ensureCsrfCookie(req, res, deps.env.cookieSecure);
      res.json({ user: toUserPayload(req.user) });
    }),
  );

  return router;
};
