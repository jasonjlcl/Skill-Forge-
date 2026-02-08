import { randomUUID } from 'node:crypto';
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../domain/deps.js';
import { requireAuth } from '../middleware/auth.js';
import { detectLanguage } from '../services/language.js';
import { registerSseConnection } from '../services/sseRegistry.js';

const streamQuerySchema = z.object({
  session_id: z.string().uuid().optional(),
  message: z.string().min(1),
  module: z.string().optional(),
  top_k: z.coerce.number().optional(),
  time_seconds: z.coerce.number().optional(),
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

export const createChatRouter = (deps: AppDeps): Router => {
  const router = Router();

  router.post('/session', requireAuth(deps.store), async (req, res) => {
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

    res.status(201).json({
      sessionId: session.id,
      module: session.module,
      startedAt: session.startedAt.toISOString(),
    });
  });

  router.get('/stream', requireAuth(deps.store), async (req, res) => {
    const parsed = streamQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid query parameters' });
      return;
    }

    const { session_id: sessionIdFromQuery, message, module, top_k: topK, time_seconds: timeSeconds } =
      parsed.data;

    let session = sessionIdFromQuery ? await deps.store.getSession(sessionIdFromQuery) : null;
    const effectiveModule = module || session?.module || 'General Onboarding';

    if (!session) {
      session = await deps.store.createSession({
        id: sessionIdFromQuery,
        userId: req.user.id,
        module: effectiveModule,
      });
    }

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
      topK: topK ?? 4,
      module: effectiveModule,
    });

    const completion = await deps.llm.generateAssistance({
      question: message,
      language: responseLanguage,
      skillLevel: req.user.skillLevel,
      module: effectiveModule,
      contextChunks,
    });

    await deps.store.createMessage({
      sessionId: session.id,
      role: 'assistant',
      content: completion.answer,
    });

    await deps.store.upsertModuleProgress({
      userId: req.user.id,
      module: effectiveModule,
      timeDeltaSeconds: Math.max(5, Math.floor(timeSeconds ?? 15)),
      completed: false,
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    registerSseConnection(res);

    let closed = false;
    res.on('close', () => {
      closed = true;
    });

    writeSse(res, 'meta', {
      sessionId: session.id,
      module: effectiveModule,
      sources: contextChunks.map((chunk) => ({ id: chunk.id, source: chunk.source, score: chunk.score })),
    });

    const tokens = completion.answer.split(/(\s+)/);
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

    if (closed) {
      return;
    }

    writeSse(res, 'done', {
      sessionId: session.id,
      answer: completion.answer,
    });
    res.end();
  });

  router.post('/explain', requireAuth(deps.store), async (req, res) => {
    const parsed = explainSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' });
      return;
    }

    const { sessionId, module, question, answer } = parsed.data;

    const contextChunks = await deps.vectorStore.query({
      query: question,
      topK: 4,
      module,
    });

    const explanation = await deps.llm.explainWhy({
      question,
      answer,
      language: req.user.language,
      contextChunks,
    });

    if (sessionId) {
      const session = await deps.store.getSession(sessionId);
      if (session && session.userId === req.user.id) {
        await deps.store.createMessage({
          sessionId,
          role: 'assistant',
          content: `Explain Why: ${explanation}`,
        });
      }
    }

    res.json({
      explanation,
      sources: contextChunks.map((chunk) => ({ id: chunk.id, source: chunk.source, score: chunk.score })),
    });
  });

  return router;
};
