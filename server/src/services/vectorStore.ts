import { env } from '../config/env.js';
import { cosineSimilarity, embedText } from './embeddings.js';

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
  query(input: { query: string; topK: number; module?: string }): Promise<RetrievedChunk[]>;
}

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
  }): Promise<void>;
  query(input: {
    queryEmbeddings: number[][];
    nResults: number;
    where?: Record<string, string>;
  }): Promise<ChromaQueryResult>;
}

export class InMemoryVectorStore implements VectorStore {
  private chunks = new Map<string, IndexedChunk>();

  async upsert(chunks: TrainingChunk[]): Promise<void> {
    for (const chunk of chunks) {
      this.chunks.set(chunk.id, {
        ...chunk,
        embedding: embedText(chunk.text),
      });
    }
  }

  async query(input: { query: string; topK: number; module?: string }): Promise<RetrievedChunk[]> {
    const queryEmbedding = embedText(input.query);

    const candidates = [...this.chunks.values()].filter(
      (chunk) => !input.module || chunk.module === input.module,
    );

    return candidates
      .map((chunk) => ({
        ...chunk,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, input.topK))
      .map((chunk) => {
        const { embedding, ...rest } = chunk;
        void embedding;
        return rest;
      });
  }
}

class ChromaVectorStore implements VectorStore {
  private readonly fallback = new InMemoryVectorStore();
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
      const collection = await this.getCollection();
      await collection.upsert({
        ids: chunks.map((chunk) => chunk.id),
        documents: chunks.map((chunk) => chunk.text),
        embeddings: chunks.map((chunk) => embedText(chunk.text)),
        metadatas: chunks.map((chunk) => ({
          module: chunk.module,
          source: chunk.source,
          ...chunk.metadata,
        })),
      });
    } catch {
      // fall back to in-memory behavior when Chroma is unavailable
    }
  }

  async query(input: { query: string; topK: number; module?: string }): Promise<RetrievedChunk[]> {
    try {
      const collection = await this.getCollection();
      const result = await collection.query({
        queryEmbeddings: [embedText(input.query)],
        nResults: Math.max(1, input.topK),
        where: input.module ? { module: input.module } : undefined,
      });

      const ids = result.ids?.[0] ?? [];
      const docs = result.documents?.[0] ?? [];
      const metadatas = result.metadatas?.[0] ?? [];
      const distances = result.distances?.[0] ?? [];

      return ids.map((id: string, index: number) => ({
        id,
        text: docs[index] ?? '',
        module: (metadatas[index]?.module as string) ?? input.module ?? 'General Onboarding',
        source: (metadatas[index]?.source as string) ?? 'unknown',
        metadata: metadatas[index] ?? {},
        score: distances[index] !== undefined ? 1 / (1 + distances[index]) : 0,
      }));
    } catch {
      return this.fallback.query(input);
    }
  }
}

let activeVectorStore: VectorStore | null = null;

export const createVectorStore = (): VectorStore => {
  if (env.CHROMA_URL) {
    return new ChromaVectorStore();
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
