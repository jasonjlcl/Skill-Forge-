import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';

export interface PendingStreamRequest {
  sessionId?: string;
  message: string;
  module?: string;
  topK?: number;
  timeSeconds?: number;
}

interface PendingStreamRequestRecord extends PendingStreamRequest {
  id: string;
  userId: string;
  createdAtMs: number;
}

const pendingRequests = new Map<string, PendingStreamRequestRecord>();

const getExpiryMs = (): number => env.streamRequestTtlSeconds * 1000;

const purgeExpired = (): void => {
  const now = Date.now();
  const expiryMs = getExpiryMs();

  for (const [id, record] of pendingRequests.entries()) {
    if (now - record.createdAtMs > expiryMs) {
      pendingRequests.delete(id);
    }
  }
};

export const registerStreamRequest = (userId: string, request: PendingStreamRequest): string => {
  purgeExpired();

  const id = randomUUID();
  pendingRequests.set(id, {
    ...request,
    id,
    userId,
    createdAtMs: Date.now(),
  });

  return id;
};

export const consumeStreamRequest = (userId: string, streamId: string): PendingStreamRequest | null => {
  purgeExpired();

  const record = pendingRequests.get(streamId);
  if (!record || record.userId !== userId) {
    return null;
  }

  pendingRequests.delete(streamId);
  return {
    sessionId: record.sessionId,
    message: record.message,
    module: record.module,
    topK: record.topK,
    timeSeconds: record.timeSeconds,
  };
};

