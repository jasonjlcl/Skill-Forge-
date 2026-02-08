import type { NextFunction, Request, Response } from 'express';
import type { DataStore } from '../store/types.js';
import { verifyAuthToken } from '../services/jwt.js';

export const requireAuth = (store: DataStore) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = req.cookies?.auth_token;
    if (!token || typeof token !== 'string') {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const payload = verifyAuthToken(token);
    if (!payload) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const user = await store.getUserById(payload.userId);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    req.user = user;
    next();
  };
};
