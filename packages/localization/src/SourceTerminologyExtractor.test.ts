import { describe, expect, it, vi } from 'vitest';
import { SourceTerminologyExtractor } from './SourceTerminologyExtractor';

function createExtractor(responses: Array<string | Error>) {
  const createResponse = vi.fn(async () => {
    const content = responses.shift();
    if (content === undefined) throw new Error('Missing mock response');
    if (content instanceof Error) throw content;
    return { content, status: 200, endpoint: 'https://example.test/chat/completions' };
  });
  const extractor = new SourceTerminologyExtractor({
    providerCatalogService: {
      resolveProviderConfig: () => ({
        provider: {
          id: 'provider:test',
          name: 'Test',
          baseUrl: 'https://example.test',
          model: 'test-model',
          protocol: 'chat-completions',
          kind: 'configured',
          connectionId: 'connection:test',
          connectionName: 'Test',
          createdAt: '1970-01-01T00:00:00.000Z',
          updatedAt: '1970-01-01T00:00:00.000Z',
        },
        apiKey: 'secret',
      }),
    },
    aiRuntimeConfigProvider: {
      getModelConfig: vi.fn(async () => ({ reasoningEffort: 'low' as const })),
    },
    aiTransport: {
      createResponse,
      listModels: vi.fn(),
      testConnection: vi.fn(),
    },
  });
  return { extractor, createResponse };
}

describe('SourceTerminologyExtractor', () => {
  it('caps provider batches at ten unique source rows', async () => {
    const firstBatch = Array.from({ length: 10 }, (_, index) => ({
      id: `source-term-${index + 1}`,
      terms: [{ sourceTerm: `FeatureName${index + 1}` }],
    }));
    const { extractor, createResponse } = createExtractor([
      JSON.stringify({ segments: firstBatch }),
      JSON.stringify({
        segments: [{ id: 'source-term-11', terms: [{ sourceTerm: 'FeatureName11' }] }],
      }),
    ]);

    const result = await extractor.extract({
      sourceLanguage: 'en',
      units: Array.from({ length: 11 }, (_, index) => ({
        documentId: 'file-1',
        unitId: `row-${index + 1}`,
        source: `Open FeatureName${index + 1}`,
      })),
    });

    expect(createResponse).toHaveBeenCalledTimes(2);
    expect(result.summary).toEqual({
      total: 11,
      ready: 11,
      error: 0,
      cancelled: 0,
      uniqueTerms: 11,
    });
  });

  it('runs provider batches with bounded concurrency', async () => {
    const { extractor, createResponse } = createExtractor([]);
    let active = 0;
    let maxActive = 0;
    let callCount = 0;
    createResponse.mockImplementation(async () => {
      const call = ++callCount;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active -= 1;
      return {
        content: JSON.stringify({
          segments: [{ id: `source-term-${call}`, terms: [{ sourceTerm: `FeatureName${call}` }] }],
        }),
        status: 200,
        endpoint: 'https://example.test/chat/completions',
      };
    });

    const result = await extractor.extract({
      sourceLanguage: 'en',
      units: Array.from({ length: 3 }, (_, index) => ({
        documentId: 'file-1',
        unitId: `row-${index + 1}`,
        source: `Open FeatureName${index + 1}`,
      })),
      options: { batchSize: 1, maxConcurrency: 2 },
    });

    expect(maxActive).toBe(2);
    expect(result.summary).toEqual({
      total: 3,
      ready: 3,
      error: 0,
      cancelled: 0,
      uniqueTerms: 3,
    });
  });

  it('keeps an in-flight batch result and does not start new requests after cancellation', async () => {
    const { extractor, createResponse } = createExtractor([]);
    let cancelRequested = false;
    let resolveFirstResponse:
      | ((value: { content: string; status: number; endpoint: string }) => void)
      | undefined;
    createResponse.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirstResponse = resolve;
        }),
    );

    const promise = extractor.extract({
      sourceLanguage: 'en',
      units: Array.from({ length: 3 }, (_, index) => ({
        documentId: 'file-1',
        unitId: `row-${index + 1}`,
        source: `FeatureName${index + 1}`,
      })),
      options: { batchSize: 1, maxConcurrency: 1 },
      cancellationToken: { isCancellationRequested: () => cancelRequested },
    });

    await vi.waitFor(() => expect(createResponse).toHaveBeenCalledTimes(1));
    cancelRequested = true;
    resolveFirstResponse?.({
      content: JSON.stringify({
        segments: [{ id: 'source-term-1', terms: [{ sourceTerm: 'FeatureName1' }] }],
      }),
      status: 200,
      endpoint: 'https://example.test/chat/completions',
    });

    const result = await promise;

    expect(createResponse).toHaveBeenCalledTimes(1);
    expect(result.units.map((unit) => unit.status)).toEqual(['ready', 'cancelled', 'cancelled']);
    expect(result.terms).toMatchObject([{ sourceTerm: 'FeatureName1', occurrences: 1 }]);
    expect(result.summary).toEqual({
      total: 3,
      ready: 1,
      error: 0,
      cancelled: 2,
      uniqueTerms: 1,
    });
  });

  it('reuses extraction for duplicate sources and aggregates per-unit candidates', async () => {
    const { extractor, createResponse } = createExtractor([
      JSON.stringify({
        segments: [
          {
            id: 'source-term-1',
            terms: [
              { sourceTerm: 'Account Settings' },
              { sourceTerm: 'Account Settings' },
              { sourceTerm: 'Not In Source' },
            ],
          },
        ],
      }),
    ]);
    const progress: Array<[number, number]> = [];

    const result = await extractor.extract({
      sourceLanguage: 'en',
      units: [
        {
          documentId: 'file-1',
          unitId: 'row-1',
          rowNumber: 2,
          source: 'Open Account Settings',
        },
        {
          documentId: 'file-1',
          unitId: 'row-2',
          rowNumber: 3,
          source: 'Open Account Settings',
        },
      ],
      onProgress: (current, total) => progress.push([current, total]),
    });

    expect(createResponse).toHaveBeenCalledTimes(1);
    expect(result.units.map((unit) => unit.sourceTerms)).toEqual([
      ['Account Settings'],
      ['Account Settings'],
    ]);
    expect(result.terms).toMatchObject([
      { sourceTerm: 'Account Settings', occurrences: 2, rowNumbers: [2, 3] },
    ]);
    expect(result.summary).toEqual({
      total: 2,
      ready: 2,
      error: 0,
      cancelled: 0,
      uniqueTerms: 1,
    });
    expect(progress).toEqual([
      [0, 2],
      [2, 2],
    ]);
  });

  it('filters terms already covered by historical terminology variants', async () => {
    const { extractor } = createExtractor([
      JSON.stringify({
        segments: [
          {
            id: 'source-term-1',
            terms: [{ sourceTerm: 'Preferences' }, { sourceTerm: 'Recovery Code' }],
          },
        ],
      }),
    ]);

    const result = await extractor.extract({
      sourceLanguage: 'en',
      units: [
        {
          documentId: 'file-1',
          unitId: 'row-1',
          source: 'Preferences require a Recovery Code',
          historicalTerms: [{ sourceTerm: 'Preference' }],
        },
      ],
    });

    expect(result.units[0].sourceTerms).toEqual(['Recovery Code']);
  });

  it('accepts both an empty result and a term spanning the complete segment', async () => {
    const { extractor, createResponse } = createExtractor([
      JSON.stringify({
        segments: [
          { id: 'source-term-1', terms: [] },
          { id: 'source-term-2', terms: [{ sourceTerm: 'Project Codename' }] },
        ],
      }),
    ]);

    const result = await extractor.extract({
      sourceLanguage: 'en',
      units: [
        { documentId: 'file-1', unitId: 'row-1', source: 'An ordinary source sentence.' },
        { documentId: 'file-1', unitId: 'row-2', source: 'Project Codename' },
      ],
    });

    expect(result.units.map((unit) => unit.sourceTerms)).toEqual([[], ['Project Codename']]);
    expect(createResponse.mock.calls[0][0].systemPrompt).toContain('Never force a candidate');
  });

  it('repairs one malformed response and keeps batch failures scoped', async () => {
    const { extractor, createResponse } = createExtractor([
      'not-json',
      JSON.stringify({
        segments: [{ id: 'source-term-1', terms: [{ sourceTerm: 'Recovery Code' }] }],
      }),
    ]);

    const result = await extractor.extract({
      sourceLanguage: 'en',
      units: [
        {
          documentId: 'file-1',
          unitId: 'row-1',
          source: 'Enter a Recovery Code',
        },
      ],
    });

    expect(createResponse).toHaveBeenCalledTimes(2);
    expect(createResponse.mock.calls[1][0].userPrompt).toContain('invalid strict JSON');
    expect(result.units[0]).toMatchObject({ status: 'ready', sourceTerms: ['Recovery Code'] });
  });

  it('does not retry transport failures as response-validation feedback', async () => {
    const { extractor, createResponse } = createExtractor([
      new Error('AI provider request failed with status 401'),
    ]);

    const result = await extractor.extract({
      sourceLanguage: 'en',
      units: [{ documentId: 'file-1', unitId: 'row-1', source: 'Recovery Code' }],
      options: { maxAttempts: 3 },
    });

    expect(createResponse).toHaveBeenCalledTimes(1);
    expect(result.units[0]).toMatchObject({
      status: 'error',
      sourceTerms: [],
      error: 'AI provider request failed with status 401',
    });
  });
});
