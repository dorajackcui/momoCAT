import { describe, expect, it } from 'vitest';
import { parseAITranslationSegmentIds } from './aiTranslationScope';

describe('AI translation scope', () => {
  it.each(
    [
      [],
      null,
      'seg-1',
      [1],
      [''],
      ['  '],
      new Array(1),
      Object.assign(new Array(3), { 0: 'seg-1', 2: 'seg-2' }),
    ].map((value) => ({ value })),
  )('rejects invalid scopes including sparse arrays ($value)', ({ value }) => {
    expect(() => parseAITranslationSegmentIds(value)).toThrow('non-empty list of segment IDs');
  });

  it('preserves omitted scope and snapshots ordered, deduplicated identities', () => {
    expect(parseAITranslationSegmentIds(undefined)).toBeUndefined();
    const input = ['seg-2', 'seg-1', 'seg-2', 'seg-1 '];
    const result = parseAITranslationSegmentIds(input);
    expect(result).toEqual(['seg-2', 'seg-1', 'seg-1 ']);
    expect(result).not.toBe(input);
    input[0] = 'changed';
    expect(result?.[0]).toBe('seg-2');
  });
});
