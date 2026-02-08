import type { User } from '../domain/types.js';

declare global {
  namespace Express {
    interface Request {
      user: User;
    }
  }
}

export {};
