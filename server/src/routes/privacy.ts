import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../domain/deps.js';
import { requireAuth } from '../middleware/auth.js';
import { wrapAsync } from '../middleware/async.js';
import { clearCsrfCookie, requireCsrf } from '../middleware/csrf.js';

const deleteSchema = z.object({
  confirmEmail: z.string().email(),
});

const retentionSchema = z.object({
  days: z.coerce.number().int().min(1).max(3650).optional(),
});

export const createPrivacyRouter = (deps: AppDeps): Router => {
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

  router.get(
    '/export',
    requireAuth(deps.store),
    wrapAsync(async (req, res) => {
      const data = await deps.store.exportUserData(req.user.id);
      if (!data) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.setHeader('Content-Disposition', `attachment; filename="skill-forge-export-${req.user.id}.json"`);
      res.json({
        exportVersion: '2026-03-01',
        retentionPolicyDays: deps.env.dataRetentionDays,
        ...data,
      });
    }),
  );

  router.post(
    '/retention/run',
    requireAuth(deps.store),
    requireCsrf,
    wrapAsync(async (req, res) => {
      const parsed = retentionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' });
        return;
      }

      const retentionDays = parsed.data.days ?? deps.env.dataRetentionDays;
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const purged = await deps.store.purgeRetainedData({
        userId: req.user.id,
        cutoff,
      });

      res.json({
        retentionDays,
        cutoff: cutoff.toISOString(),
        purged,
      });
    }),
  );

  router.delete(
    '/',
    requireAuth(deps.store),
    requireCsrf,
    wrapAsync(async (req, res) => {
      const parsed = deleteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' });
        return;
      }

      const confirmEmail = parsed.data.confirmEmail.trim().toLowerCase();
      if (confirmEmail !== req.user.email.toLowerCase()) {
        res.status(400).json({ error: 'Confirmation email does not match the authenticated account.' });
        return;
      }

      const deleted = await deps.store.deleteUserData(req.user.id);
      if (!deleted) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.clearCookie('auth_token', authClearCookieOptions);
      clearCsrfCookie(res, deps.env.cookieSecure);
      res.status(204).send();
    }),
  );

  return router;
};
