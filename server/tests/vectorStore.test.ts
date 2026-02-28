import { applyContextBudget, InMemoryVectorStore, type TrainingChunk } from '../src/services/vectorStore.js';

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

  it('trims context chunks to fit the configured context budget', () => {
    const trimmed = applyContextBudget(
      [
        {
          id: 'chunk-1',
          module: 'Safety Basics',
          source: 'safety.md',
          text: 'A'.repeat(12),
          score: 0.92,
        },
        {
          id: 'chunk-2',
          module: 'Safety Basics',
          source: 'safety.md',
          text: 'B'.repeat(12),
          score: 0.87,
        },
      ],
      18,
    );

    expect(trimmed).toHaveLength(2);
    expect(trimmed[0].text).toHaveLength(12);
    expect(trimmed[1].text).toHaveLength(6);
    expect(trimmed[1].text.endsWith('...')).toBe(true);
    expect(trimmed.reduce((sum, chunk) => sum + chunk.text.length, 0)).toBeLessThanOrEqual(18);
  });
});
