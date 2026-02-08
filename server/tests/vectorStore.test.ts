import { InMemoryVectorStore, type TrainingChunk } from '../src/services/vectorStore.js';

describe('InMemoryVectorStore', () => {
  it('returns the most relevant chunk for a query', async () => {
    const store = new InMemoryVectorStore();
    const chunks: TrainingChunk[] = [
      {
        id: '1',
        module: 'Safety Basics',
        source: 'sop.md',
        text: 'Always verify lockout tagout before servicing a machine.',
      },
      {
        id: '2',
        module: 'Quality Control',
        source: 'quality.md',
        text: 'Record dimensional checks every 30 minutes for traceability.',
      },
    ];

    await store.upsert(chunks);

    const result = await store.query({
      query: 'What should I do for lockout and tagout?',
      topK: 1,
      module: 'Safety Basics',
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
    expect(result[0].module).toBe('Safety Basics');
  });
});
