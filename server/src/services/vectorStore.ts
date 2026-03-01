import { env } from '../config/env.js';
import { cosineSimilarity, embedText, embedTexts } from './embeddings.js';
import {
  CircuitBreaker,
  executeWithResilience,
  isTransientUpstreamError,
  type RetryOptions,
} from './resilience.js';
import { withObservedSpan } from './observability.js';

export interface TrainingChunk {
  id: string;
  text: string;
  module: string;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface RetrievedChunk extends TrainingChunk {
  score: number;
}

export interface VectorStore {
  upsert(chunks: TrainingChunk[]): Promise<void>;
  query(input: VectorStoreQueryInput): Promise<RetrievedChunk[]>;
}

export interface VectorStoreQueryInput {
  query: string;
  topK: number;
  module?: string;
  minScore?: number;
}

const truncateText = (text: string, maxChars: number): string => {
  if (maxChars <= 0) {
    return '';
  }

  if (text.length <= maxChars) {
    return text;
  }

  if (maxChars <= 3) {
    return text.slice(0, maxChars);
  }

  return `${text.slice(0, maxChars - 3).trimEnd()}...`;
};

export const applyContextBudget = <TChunk extends RetrievedChunk>(
  chunks: TChunk[],
  maxChars: number,
): TChunk[] => {
  const budget = Math.max(1, Math.floor(maxChars));
  const capped: TChunk[] = [];
  let remaining = budget;

  for (const chunk of chunks) {
    if (remaining <= 0) {
      break;
    }

    const trimmedText = truncateText(chunk.text, remaining);
    if (!trimmedText) {
      break;
    }

    capped.push({
      ...chunk,
      text: trimmedText,
    });

    remaining -= trimmedText.length;
  }

  return capped;
};

interface IndexedChunk extends TrainingChunk {
  embedding: number[];
}

interface ChromaQueryResult {
  ids?: string[][];
  documents?: string[][];
  metadatas?: Array<Array<Record<string, unknown>>>;
  distances?: number[][];
}

interface ChromaCollection {
  upsert(input: {
    ids: string[];
    documents: string[];
    embeddings: number[][];
    metadatas: Array<Record<string, unknown>>;
  }): Promise<void | boolean>;
  query(input: {
    queryEmbeddings: number[][];
    nResults: number;
    where?: Record<string, string>;
  }): Promise<ChromaQueryResult>;
}

const vectorRetryPolicy = (): RetryOptions => ({
  maxAttempts: env.vectorRetryMaxAttempts,
  baseDelayMs: env.vectorRetryBaseDelayMs,
  maxDelayMs: env.vectorRetryMaxDelayMs,
  jitterRatio: env.retryJitterRatio,
  isRetryable: isTransientUpstreamError,
});

const chromaQueryCircuit = new CircuitBreaker({
  name: 'chroma.query',
  failureThreshold: env.vectorCircuitFailureThreshold,
  openMs: env.vectorCircuitOpenMs,
  shouldRecordFailure: isTransientUpstreamError,
});

const chromaUpsertCircuit = new CircuitBreaker({
  name: 'chroma.upsert',
  failureThreshold: env.vectorCircuitFailureThreshold,
  openMs: env.vectorCircuitOpenMs,
  shouldRecordFailure: isTransientUpstreamError,
});

export class InMemoryVectorStore implements VectorStore {
  private chunks = new Map<string, IndexedChunk>();

  async upsert(chunks: TrainingChunk[]): Promise<void> {
    await withObservedSpan(
      {
        spanName: 'vector.upsert.in_memory',
        operation: 'vector.upsert',
        attributes: {
          backend: 'in_memory',
        },
      },
      async () => {
        const embeddings = await embedTexts(chunks.map((chunk) => chunk.text));
        for (let index = 0; index < chunks.length; index += 1) {
          const chunk = chunks[index];
          this.chunks.set(chunk.id, {
            ...chunk,
            embedding: embeddings[index],
          });
        }
      },
    );
  }

  async query(input: VectorStoreQueryInput): Promise<RetrievedChunk[]> {
    return withObservedSpan(
      {
        spanName: 'vector.query.in_memory',
        operation: 'vector.query',
        attributes: {
          backend: 'in_memory',
        },
      },
      async () => {
        const queryEmbedding = await embedText(input.query);
        const minScore = Math.max(0, Math.min(1, input.minScore ?? 0));

        const candidates = [...this.chunks.values()].filter(
          (chunk) => !input.module || chunk.module === input.module,
        );

        const ranked = candidates
          .map((chunk) => ({
            ...chunk,
            score: cosineSimilarity(queryEmbedding, chunk.embedding),
          }))
          .filter((chunk) => chunk.score >= minScore)
          .sort((a, b) => b.score - a.score)
          .slice(0, Math.max(1, input.topK))
          .map((chunk) => {
            const { embedding, ...rest } = chunk;
            void embedding;
            return rest;
          });

        return applyContextBudget(ranked, env.ragMaxContextChars);
      },
    );
  }
}

class ChromaVectorStore implements VectorStore {
  private readonly fallback = new InMemoryVectorStore();
  private readonly allowFallback = env.NODE_ENV !== 'production';
  private collectionReady: Promise<ChromaCollection> | null = null;

  private async getCollection(): Promise<ChromaCollection> {
    if (!this.collectionReady) {
      this.collectionReady = this.initializeCollection();
    }

    return this.collectionReady;
  }

  private async initializeCollection(): Promise<ChromaCollection> {
    const { ChromaClient } = await import('chromadb');

    const client = new ChromaClient({ path: env.CHROMA_URL });
    const collection = await client.getOrCreateCollection({
      name: env.CHROMA_COLLECTION,
      metadata: { purpose: 'genai_onboarding_training_docs' },
    });
    return collection as ChromaCollection;
  }

  async upsert(chunks: TrainingChunk[]): Promise<void> {
    await this.fallback.upsert(chunks);

    try {
      await withObservedSpan(
        {
          spanName: 'vector.upsert.chroma',
          operation: 'vector.upsert',
          attributes: {
            backend: 'chroma',
          },
          metricAttributes: {
            backend: 'chroma',
          },
        },
        () =>
          executeWithResilience(
            async () => {
              const collection = await this.getCollection();
              const embeddings = await embedTexts(chunks.map((chunk) => chunk.text));
              await collection.upsert({
                ids: chunks.map((chunk) => chunk.id),
                documents: chunks.map((chunk) => chunk.text),
                embeddings,
                metadatas: chunks.map((chunk) => ({
                  module: chunk.module,
                  source: chunk.source,
                  ...chunk.metadata,
                })),
              });
            },
            {
              circuitBreaker: chromaUpsertCircuit,
              retry: vectorRetryPolicy(),
              shouldRecordFailure: isTransientUpstreamError,
            },
          ),
      );
    } catch (error) {
      if (!this.allowFallback) {
        throw new Error(
          `Chroma upsert failed in production: ${error instanceof Error ? error.message : 'Unknown Chroma error'}`,
        );
      }
      // fall back to in-memory behavior when Chroma is unavailable in non-production environments
    }
  }

  async query(input: VectorStoreQueryInput): Promise<RetrievedChunk[]> {
    const minScore = Math.max(0, Math.min(1, input.minScore ?? 0));

    try {
      const result = await withObservedSpan(
        {
          spanName: 'vector.query.chroma',
          operation: 'vector.query',
          attributes: {
            backend: 'chroma',
          },
          metricAttributes: {
            backend: 'chroma',
          },
        },
        () =>
          executeWithResilience(
            async () => {
              const collection = await this.getCollection();
              const queryEmbedding = await embedText(input.query);
              return collection.query({
                queryEmbeddings: [queryEmbedding],
                nResults: Math.max(1, input.topK),
                where: input.module ? { module: input.module } : undefined,
              });
            },
            {
              circuitBreaker: chromaQueryCircuit,
              retry: vectorRetryPolicy(),
              shouldRecordFailure: isTransientUpstreamError,
            },
          ),
      );

      const ids = result.ids?.[0] ?? [];
      const docs = result.documents?.[0] ?? [];
      const metadatas = result.metadatas?.[0] ?? [];
      const distances = result.distances?.[0] ?? [];

      const ranked = ids
        .map((id: string, index: number) => ({
          id,
          text: docs[index] ?? '',
          module: (metadatas[index]?.module as string) ?? input.module ?? 'General Onboarding',
          source: (metadatas[index]?.source as string) ?? 'unknown',
          metadata: metadatas[index] ?? {},
          score: distances[index] !== undefined ? 1 / (1 + distances[index]) : 0,
        }))
        .filter((chunk) => chunk.score >= minScore);

      return applyContextBudget(ranked, env.ragMaxContextChars);
    } catch (error) {
      if (!this.allowFallback) {
        throw new Error(
          `Chroma query failed in production: ${error instanceof Error ? error.message : 'Unknown Chroma error'}`,
        );
      }
      return this.fallback.query(input);
    }
  }
}

let activeVectorStore: VectorStore | null = null;

export const createVectorStore = (): VectorStore => {
  if (env.CHROMA_URL) {
    return new ChromaVectorStore();
  }

  if (env.NODE_ENV === 'production') {
    throw new Error('Chroma vector store is required in production. Ensure CHROMA_URL is configured.');
  }

  return new InMemoryVectorStore();
};

export const getVectorStore = (): VectorStore => {
  if (!activeVectorStore) {
    activeVectorStore = createVectorStore();
  }
  return activeVectorStore;
};

export const setVectorStore = (vectorStore: VectorStore): void => {
  activeVectorStore = vectorStore;
};
