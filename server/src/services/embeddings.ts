import OpenAI from 'openai';
import { env } from '../config/env.js';

const HASH_VECTOR_SIZE = 256;
const MAX_EMBED_TEXT_CHARS = 8000;
const embeddingCache = new Map<string, number[]>();
const openaiClient = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;
let embeddingFallbackWarningEmitted = false;

const rememberEmbedding = (text: string, vector: number[]): void => {
  if (env.embeddingCacheMaxEntries <= 0) {
    return;
  }

  if (embeddingCache.has(text)) {
    embeddingCache.delete(text);
  }
  embeddingCache.set(text, vector);

  while (embeddingCache.size > env.embeddingCacheMaxEntries) {
    const oldest = embeddingCache.keys().next();
    if (oldest.done) {
      return;
    }
    embeddingCache.delete(oldest.value);
  }
};

const logEmbeddingFallbackWarning = (reason: string): void => {
  if (embeddingFallbackWarningEmitted) {
    return;
  }

  embeddingFallbackWarningEmitted = true;
  console.warn(
    JSON.stringify({
      level: 'warn',
      message: 'embedding_provider_fallback',
      timestamp: new Date().toISOString(),
      configuredProvider: env.embeddingProvider,
      activeProvider: 'hash',
      reason,
    }),
  );
};

const hashToken = (token: string): number => {
  let hash = 0;
  for (let i = 0; i < token.length; i += 1) {
    hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
  }
  return hash;
};

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);

const normalizeVector = (vector: number[]): number[] => {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    return vector;
  }
  return vector.map((value) => value / norm);
};

const hashEmbedText = (text: string): number[] => {
  const vector = new Array<number>(HASH_VECTOR_SIZE).fill(0);
  const tokens = tokenize(text);

  if (tokens.length === 0) {
    return vector;
  }

  for (const token of tokens) {
    const hash = hashToken(token);
    const index = hash % HASH_VECTOR_SIZE;
    vector[index] += 1;
  }

  return normalizeVector(vector);
};

const sanitizeInput = (text: string): string => {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length <= MAX_EMBED_TEXT_CHARS ? compact : compact.slice(0, MAX_EMBED_TEXT_CHARS);
};

const canUseOpenAi = (): boolean => Boolean(openaiClient);

const embedBatchWithOpenAi = async (input: string[]): Promise<number[][]> => {
  const client = openaiClient;
  if (!client || !canUseOpenAi()) {
    logEmbeddingFallbackWarning('OPENAI_API_KEY is not configured');
    return input.map((text) => hashEmbedText(text));
  }

  const response = await client.embeddings.create({
    model: env.openaiEmbeddingModel,
    input,
  });

  const ordered = response.data.slice().sort((a, b) => a.index - b.index).map((row) => row.embedding);
  return ordered.map((vector) => normalizeVector(vector));
};

const embedWithConfiguredProvider = async (input: string[]): Promise<number[][]> => {
  if (env.embeddingProvider === 'hash') {
    return input.map((text) => hashEmbedText(text));
  }

  try {
    return await embedBatchWithOpenAi(input);
  } catch (error) {
    logEmbeddingFallbackWarning(
      `Semantic embedding request failed: ${error instanceof Error ? error.message : 'Unknown embedding error'}`,
    );
    return input.map((text) => hashEmbedText(text));
  }
};

export const embedTexts = async (texts: string[]): Promise<number[][]> => {
  if (texts.length === 0) {
    return [];
  }

  const prepared = texts.map((text) => sanitizeInput(text));
  const result = new Array<number[]>(prepared.length);
  const missing: string[] = [];
  const missingIndexes: number[] = [];

  for (let i = 0; i < prepared.length; i += 1) {
    const cached = embeddingCache.get(prepared[i]);
    if (cached) {
      result[i] = cached;
      continue;
    }
    missing.push(prepared[i]);
    missingIndexes.push(i);
  }

  if (missing.length > 0) {
    for (let offset = 0; offset < missing.length; offset += env.embeddingBatchSize) {
      const batch = missing.slice(offset, offset + env.embeddingBatchSize);
      const embeddedBatch = await embedWithConfiguredProvider(batch);

      for (let index = 0; index < batch.length; index += 1) {
        const text = batch[index];
        const vector = embeddedBatch[index];
        rememberEmbedding(text, vector);
        const originalIndex = missingIndexes[offset + index];
        result[originalIndex] = vector;
      }
    }
  }

  return result;
};

export const embedText = async (text: string): Promise<number[]> => {
  const [vector] = await embedTexts([text]);
  return vector;
};

export const cosineSimilarity = (a: number[], b: number[]): number => {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};
