import bcrypt from 'bcrypt';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../domain/deps.js';
import { requireAuth } from '../middleware/auth.js';
import { normalizeLanguage } from '../services/language.js';
import { signAuthToken } from '../services/jwt.js';
import type { SkillLevel } from '../domain/types.js';

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

  const cookieBase = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: deps.env.cookieSecure,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };

  router.post('/register', async (req, res) => {
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

    const token = signAuthToken({ userId: user.id, email: user.email });
    res.cookie('auth_token', token, cookieBase);
    res.status(201).json({ user: toUserPayload(user) });
  });

  router.post('/login', async (req, res) => {
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

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = signAuthToken({ userId: user.id, email: user.email });
    res.cookie('auth_token', token, cookieBase);
    res.json({ user: toUserPayload(user) });
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie('auth_token', cookieBase);
    res.status(204).send();
  });

  router.get('/me', requireAuth(deps.store), async (req, res) => {
    res.json({ user: toUserPayload(req.user) });
  });

  return router;
};
