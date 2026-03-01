import { timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../domain/deps.js';
import { wrapAsync } from '../middleware/async.js';
import { verifyGoogleOidcToken } from '../services/googleOidc.js';

const retentionRunSchema = z.object({
  days: z.coerce.number().int().min(1).max(3650).optional(),
});

const parseBearerToken = (authorizationHeader: string | undefined): string | null => {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
    return null;
  }

  return token.trim();
};

const isTokenMatch = (candidate: string, expected: string): boolean => {
  const candidateBytes = Buffer.from(candidate, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (candidateBytes.length !== expectedBytes.length) {
    return false;
  }
  return timingSafeEqual(candidateBytes, expectedBytes);
};

const buildInternalAuthMiddleware = (deps: AppDeps) =>
  wrapAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = parseBearerToken(req.header('authorization'));
    if (!token) {
      res.status(401).json({ error: 'Missing bearer token.' });
      return;
    }

    if (deps.env.retentionJobAuthToken) {
      if (!isTokenMatch(token, deps.env.retentionJobAuthToken)) {
        res.status(401).json({ error: 'Invalid bearer token.' });
        return;
      }

      req.internalPrincipal = 'retention-job-token';
      next();
      return;
    }

    if (!deps.env.retentionJobOidcAudience) {
      res.status(503).json({ error: 'Internal retention endpoint is not configured.' });
      return;
    }

    try {
      const principal = await verifyGoogleOidcToken({
        idToken: token,
        audience: deps.env.retentionJobOidcAudience,
        allowedServiceAccounts: deps.env.retentionJobAllowedServiceAccounts,
      });
      req.internalPrincipal = principal.email ?? principal.subject;
      next();
    } catch (error) {
      res.status(401).json({
        error: error instanceof Error ? error.message : 'Unauthorized',
      });
    }
  });

export const createInternalRouter = (deps: AppDeps): Router => {
  const router = Router();

  router.post(
    '/retention/run',
    buildInternalAuthMiddleware(deps),
    wrapAsync(async (req, res) => {
      const parsed = retentionRunSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' });
        return;
      }

      const retentionDays = parsed.data.days ?? deps.env.dataRetentionDays;
      const now = new Date();
      const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

      const purged = await deps.store.purgeRetainedData({
        cutoff,
        now,
      });

      res.json({
        retentionDays,
        cutoff: cutoff.toISOString(),
        principal: req.internalPrincipal ?? 'unknown',
        purged,
      });
    }),
  );

  return router;
};
