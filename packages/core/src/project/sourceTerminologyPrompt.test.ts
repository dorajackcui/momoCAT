import { describe, expect, it } from 'vitest';
import {
  buildSourceTerminologyPromptBundle,
  parseSourceTerminologyResponse,
} from './sourceTerminologyPrompt';

describe('source terminology prompt', () => {
  it('includes source-only extraction rules and per-segment historical terms', () => {
    const prompt = buildSourceTerminologyPromptBundle({
      sourceLanguage: 'en',
      units: [
        {
          id: 'row-1',
          source: 'Open Account Settings',
          historicalTerms: [{ sourceTerm: 'Account' }],
        },
      ],
    });

    expect(prompt.systemPrompt).toContain('Do not translate');
    expect(prompt.systemPrompt).toContain('Precision is more important than recall');
    expect(prompt.systemPrompt).toContain('Exclude ordinary common nouns');
    expect(prompt.systemPrompt).toContain('Never force a candidate');
    expect(prompt.systemPrompt).toContain('entire source segment');
    expect(prompt.systemPrompt).toContain('Capitalization, repetition');
    expect(prompt.userPrompt).toContain('Do not force a term');
    expect(prompt.userPrompt).toContain('"id": "row-1"');
    expect(prompt.userPrompt).toContain('"Account"');
    expect(prompt.userPrompt).toContain('exact source substring');
  });

  it('parses rows by id regardless of response order', () => {
    const parsed = parseSourceTerminologyResponse(
      JSON.stringify({
        segments: [
          { id: 'row-2', terms: [] },
          { id: 'row-1', terms: [{ sourceTerm: 'Account Settings' }] },
        ],
      }),
      ['row-1', 'row-2'],
    );

    expect(parsed).toEqual([
      { id: 'row-1', terms: [{ sourceTerm: 'Account Settings' }] },
      { id: 'row-2', terms: [] },
    ]);
  });

  it.each([
    ['{"segments":[{"id":"row-1","terms":[]}],"extra":true}', 'Unexpected'],
    ['{"segments":[{"id":"row-2","terms":[]}]}', 'Unknown'],
    ['{"segments":[{"id":"row-1","terms":[]},{"id":"row-1","terms":[]}]}', 'Duplicate'],
    ['{"segments":[]}', 'Missing'],
    ['```json\n{"segments":[]}\n```', 'invalid strict JSON'],
  ])('rejects malformed response contracts', (content, message) => {
    expect(() => parseSourceTerminologyResponse(content, ['row-1'])).toThrow(message);
  });
});
