import { randomUUID } from 'node:crypto';
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../domain/deps.js';
import { requireAuth } from '../middleware/auth.js';
import { wrapAsync } from '../middleware/async.js';
import { requireCsrf } from '../middleware/csrf.js';
import { LlmStreamAbortError } from '../services/gemini.js';
import { detectLanguage } from '../services/language.js';
import {
  getSafetyPolicyVersion,
  moderateAssistantOutput,
  sanitizeRetrievedContext,
} from '../services/safety.js';
import {
  recordStreamAborted,
  recordStreamCompleted,
  recordStreamStarted,
  setRequestCorrelation,
} from '../services/observability.js';
import { registerSseConnection } from '../services/sseRegistry.js';

const streamQuerySchema = z.object({
  stream_id: z.string().uuid(),
});

const streamStartSchema = z.object({
  sessionId: z.string().uuid().optional(),
  message: z.string().min(1).max(4000),
  module: z.string().optional(),
  topK: z.coerce.number().optional(),
  timeSeconds: z.coerce.number().optional(),
});

const sessionSchema = z.object({
  module: z.string().min(2).max(100),
});

const explainSchema = z.object({
  sessionId: z.string().uuid().optional(),
  module: z.string().optional(),
  question: z.string().min(1),
  answer: z.string().min(1),
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const writeSse = (res: Response, event: string, payload: unknown): void => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const toExcerpt = (text: string, maxLength = 220): string => {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 3)}...`;
};

export const createChatRouter = (deps: AppDeps): Router => {
  const router = Router();

  router.post(
    '/session',
    requireAuth(deps.store),
    requireCsrf,
    wrapAsync(async (req, res) => {
      const parsed = sessionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' });
        return;
      }

      const session = await deps.store.createSession({
        userId: req.user.id,
        module: parsed.data.module,
        id: randomUUID(),
      });
      setRequestCorrelation(req, { sessionId: session.id });

      res.status(201).json({
        sessionId: session.id,
        module: session.module,
        startedAt: session.startedAt.toISOString(),
      });
    }),
  );

  router.post(
    '/stream/start',
    requireAuth(deps.store),
    requireCsrf,
    wrapAsync(async (req, res) => {
      const parsed = streamStartSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' });
        return;
      }

      const { sessionId, message, module, topK, timeSeconds } = parsed.data;

      if (sessionId) {
        const existing = await deps.store.getSession(sessionId);
        if (existing && existing.userId !== req.user.id) {
          res.status(403).json({ error: 'Forbidden' });
          return;
        }
      }

      await deps.store.purgeExpiredPendingStreamRequests();

      const streamId = randomUUID();
      setRequestCorrelation(req, {
        streamId,
        sessionId,
      });
      await deps.store.createPendingStreamRequest({
        id: streamId,
        userId: req.user.id,
        request: {
          sessionId,
          message,
          module,
          topK,
          timeSeconds,
        },
        expiresAt: new Date(Date.now() + deps.env.streamRequestTtlSeconds * 1000),
      });

      res.status(201).json({
        streamId,
        expiresInSeconds: deps.env.streamRequestTtlSeconds,
      });
    }),
  );

  router.get(
    '/stream',
    requireAuth(deps.store),
    wrapAsync(async (req, res) => {
      const parsed = streamQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid query parameters' });
        return;
      }

      const pending = await deps.store.consumePendingStreamRequest({
        id: parsed.data.stream_id,
        userId: req.user.id,
      });
      setRequestCorrelation(req, { streamId: parsed.data.stream_id });
      if (!pending) {
        res.status(404).json({ error: 'Stream request not found or expired' });
        return;
      }

      const { sessionId: sessionIdFromQuery, message, module, topK, timeSeconds } = pending;

      let session = sessionIdFromQuery ? await deps.store.getSession(sessionIdFromQuery) : null;
      const effectiveModule = module || session?.module || 'General Onboarding';

      if (!session) {
        session = await deps.store.createSession({
          id: sessionIdFromQuery,
          userId: req.user.id,
          module: effectiveModule,
        });
      }
      setRequestCorrelation(req, { sessionId: session.id });
      recordStreamStarted({
        route: '/chat/stream',
        module: effectiveModule,
      });

      if (session.userId !== req.user.id) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      await deps.store.touchSession(session.id);
      await deps.store.createMessage({
        sessionId: session.id,
        role: 'user',
        content: message,
      });

      const detectedLanguage = detectLanguage(message);
      const responseLanguage = detectedLanguage ?? req.user.language;

      if (detectedLanguage && detectedLanguage !== req.user.language) {
        await deps.store.updateUser(req.user.id, { language: detectedLanguage });
      }

      const contextChunks = await deps.vectorStore.query({
        query: message,
        topK: topK ?? deps.env.ragTopK,
        minScore: deps.env.ragMinScore,
        module: effectiveModule,
      });
      const safeContextChunks = sanitizeRetrievedContext(contextChunks);

      const llmInput = {
        question: message,
        language: responseLanguage,
        skillLevel: req.user.skillLevel,
        module: effectiveModule,
        contextChunks: safeContextChunks,
      };
      const supportsNativeStreaming = typeof deps.llm.streamAssistance === 'function';
      let generatedAnswer = '';
      if (!supportsNativeStreaming) {
        const completion = await deps.llm.generateAssistance(llmInput);
        generatedAnswer = completion.answer;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
      registerSseConnection(res);

      let closed = false;
      let streamCompleted = false;
      res.on('close', () => {
        closed = true;
        if (!streamCompleted) {
          recordStreamAborted({
            route: '/chat/stream',
            module: effectiveModule,
          });
        }
      });

      writeSse(res, 'meta', {
        sessionId: session.id,
        module: effectiveModule,
        safetyPolicyVersion: getSafetyPolicyVersion(),
        sources: safeContextChunks.map((chunk) => ({
          id: chunk.id,
          source: chunk.source,
          score: chunk.score,
          excerpt: toExcerpt(chunk.text),
          trustLevel: chunk.trustLevel,
          riskTags: chunk.riskTags,
        })),
      });

      let streamedAnswer = '';
      const emitProviderToken = async (token: string): Promise<void> => {
        if (closed) {
          throw new LlmStreamAbortError('SSE connection closed by client');
        }
        if (!token) {
          return;
        }

        const candidate = `${streamedAnswer}${token}`;
        const previewModeration = moderateAssistantOutput({
          answer: candidate,
          module: effectiveModule,
        });
        streamedAnswer = candidate;
        if (previewModeration.decision !== 'allow') {
          // Stop forwarding suspicious content immediately; final safe text is sent in `done`.
          return;
        }
        writeSse(res, 'token', { token });
      };

      if (supportsNativeStreaming) {
        try {
          const completion = await deps.llm.streamAssistance!(llmInput, emitProviderToken);
          generatedAnswer = streamedAnswer || completion.answer;
        } catch (error) {
          if (error instanceof LlmStreamAbortError) {
            return;
          }
          throw error;
        }
      }

      const moderatedAnswer = moderateAssistantOutput({
        answer: generatedAnswer,
        module: effectiveModule,
      });

      await deps.store.createMessage({
        sessionId: session.id,
        role: 'assistant',
        content: moderatedAnswer.text,
      });

      await deps.store.upsertModuleProgress({
        userId: req.user.id,
        module: effectiveModule,
        timeDeltaSeconds: Math.max(5, Math.floor(timeSeconds ?? 15)),
        completed: false,
      });

      if (!supportsNativeStreaming) {
        const tokens = moderatedAnswer.text.split(/(\s+)/);
        for (const token of tokens) {
          if (closed) {
            return;
          }
          if (!token) {
            continue;
          }
          writeSse(res, 'token', { token });
          await sleep(20);
        }
      }

      if (closed) {
        return;
      }

      writeSse(res, 'done', {
        sessionId: session.id,
        answer: moderatedAnswer.text,
        moderation: {
          decision: moderatedAnswer.decision,
          categories: moderatedAnswer.categories,
          policyVersion: moderatedAnswer.policyVersion,
        },
      });
      streamCompleted = true;
      recordStreamCompleted({
        route: '/chat/stream',
        module: effectiveModule,
      });
      res.end();
    }),
  );

  router.post(
    '/explain',
    requireAuth(deps.store),
    requireCsrf,
    wrapAsync(async (req, res) => {
      const parsed = explainSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' });
        return;
      }

      const { sessionId, module, question, answer } = parsed.data;
      setRequestCorrelation(req, {
        sessionId,
      });

      const contextChunks = await deps.vectorStore.query({
        query: question,
        topK: deps.env.ragTopK,
        minScore: deps.env.ragMinScore,
        module,
      });
      const safeContextChunks = sanitizeRetrievedContext(contextChunks);

      const explanation = await deps.llm.explainWhy({
        question,
        answer,
        language: req.user.language,
        contextChunks: safeContextChunks,
      });
      const moderatedExplanation = moderateAssistantOutput({
        answer: explanation,
        module: module ?? 'General Onboarding',
      });

      if (sessionId) {
        const session = await deps.store.getSession(sessionId);
        if (session && session.userId === req.user.id) {
          await deps.store.createMessage({
            sessionId,
            role: 'assistant',
            content: `Explain Why: ${moderatedExplanation.text}`,
          });
        }
      }

      res.json({
        explanation: moderatedExplanation.text,
        safety: {
          decision: moderatedExplanation.decision,
          categories: moderatedExplanation.categories,
          policyVersion: moderatedExplanation.policyVersion,
        },
        sources: safeContextChunks.map((chunk) => ({
          id: chunk.id,
          source: chunk.source,
          score: chunk.score,
          excerpt: toExcerpt(chunk.text),
          trustLevel: chunk.trustLevel,
          riskTags: chunk.riskTags,
        })),
      });
    }),
  );

  return router;
};
