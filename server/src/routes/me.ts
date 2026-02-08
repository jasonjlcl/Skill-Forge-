import { Router } from 'express';
import type { AppDeps } from '../domain/deps.js';
import { requireAuth } from '../middleware/auth.js';

export const createMeRouter = (deps: AppDeps): Router => {
  const router = Router();

  router.get('/analytics', requireAuth(deps.store), async (req, res) => {
    const analytics = await deps.store.getAnalytics(req.user.id);
    res.json(analytics);
  });

  return router;
};
