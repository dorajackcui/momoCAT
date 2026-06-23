import { describe, expect, it } from 'vitest';
import {
  buildPastedSourceCsv,
  buildPastedSourceFileName,
  normalizePastedSources,
} from './pastedSourceFile';

describe('pasted source file helpers', () => {
  it('normalizes sources by trimming and skipping empty values', () => {
    expect(normalizePastedSources([' A ', '', '  ', 'BB'])).toEqual(['A', 'BB']);
  });

  it('creates recognizable sanitized file names from the first source and timestamp', () => {
    const now = new Date('2026-06-23T08:30:00.000Z');

    expect(buildPastedSourceFileName('Login: failed / retry?', now, [])).toBe(
      'Login failed retry-2026-06-23-08-30.csv',
    );
  });

  it('truncates long source summaries and resolves duplicate file names', () => {
    const now = new Date('2026-06-23T08:30:00.000Z');
    const existing = ['This is a very long source title that sh-2026-06-23-08-30.csv'];

    expect(
      buildPastedSourceFileName(
        'This is a very long source title that should be clipped after forty chars',
        now,
        existing,
      ),
    ).toBe('This is a very long source title that sh-2026-06-23-08-30-2.csv');
  });

  it('falls back when the first source cannot produce a name', () => {
    const now = new Date('2026-06-23T08:30:00.000Z');

    expect(buildPastedSourceFileName('////', now, [])).toBe(
      'Pasted Source-2026-06-23-08-30.csv',
    );
  });

  it('serializes sources to a two-column CSV with blank targets', () => {
    expect(buildPastedSourceCsv(['A', 'B, C', 'Line 1\nLine 2', 'He said "yes"'])).toBe(
      'Source,Target\r\nA,\r\n"B, C",\r\n"Line 1\nLine 2",\r\n"He said ""yes""",',
    );
  });
});
