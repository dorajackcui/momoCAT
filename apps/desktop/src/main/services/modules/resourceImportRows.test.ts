import { describe, expect, it } from 'vitest';
import { dedupeRowsLastWins } from './resourceImportRows';

interface Row {
  key: string | null;
  value: string;
}

const keyOf = (row: Row) => row.key;

describe('dedupeRowsLastWins', () => {
  it('keeps the last value for a repeated key', () => {
    const result = dedupeRowsLastWins<Row>(
      [
        { key: 'a', value: 'first' },
        { key: 'b', value: 'only' },
        { key: 'a', value: 'second' },
        { key: 'a', value: 'third' },
      ],
      keyOf,
    );

    expect(result.rows).toEqual([
      { key: 'a', value: 'third' },
      { key: 'b', value: 'only' },
    ]);
    expect(result.duplicates).toBe(2);
    expect(result.invalid).toBe(0);
  });

  it('preserves first-occurrence order while overriding values', () => {
    const result = dedupeRowsLastWins<Row>(
      [
        { key: 'c', value: 'c1' },
        { key: 'a', value: 'a1' },
        { key: 'b', value: 'b1' },
        { key: 'a', value: 'a2' },
      ],
      keyOf,
    );

    expect(result.rows.map((row) => row.key)).toEqual(['c', 'a', 'b']);
    expect(result.rows[1]).toEqual({ key: 'a', value: 'a2' });
  });

  it('counts null-key rows as invalid, not duplicates', () => {
    const result = dedupeRowsLastWins<Row>(
      [
        { key: null, value: 'skip-1' },
        { key: 'a', value: 'a1' },
        { key: null, value: 'skip-2' },
        { key: 'a', value: 'a2' },
      ],
      keyOf,
    );

    expect(result.rows).toEqual([{ key: 'a', value: 'a2' }]);
    expect(result.duplicates).toBe(1);
    expect(result.invalid).toBe(2);
  });

  it('handles empty input', () => {
    const result = dedupeRowsLastWins<Row>([], keyOf);
    expect(result).toEqual({ rows: [], duplicates: 0, invalid: 0 });
  });
});
