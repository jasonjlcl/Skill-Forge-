import type { User } from '../domain/types.js';

declare global {
  namespace Express {
    interface RequestCorrelationIds {
      sessionId?: string;
      streamId?: string;
    }

    interface Request {
      user: User;
      correlationIds?: RequestCorrelationIds;
      internalPrincipal?: string;
    }
  }
}

export {};
