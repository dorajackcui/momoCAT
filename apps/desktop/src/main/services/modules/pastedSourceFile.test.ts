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

  it('creates sanitized file names from the first five source characters and date', () => {
    const now = new Date(2026, 5, 23, 8, 30);

    expect(buildPastedSourceFileName('Login: failed / retry?', now, [])).toBe(
      'Login-2026-06-23.csv',
    );
  });

  it('truncates long source summaries and resolves duplicate file names', () => {
    const now = new Date(2026, 5, 23, 8, 30);
    const existing = ['This-2026-06-23.csv'];

    expect(
      buildPastedSourceFileName(
        'This is a very long source title',
        now,
        existing,
      ),
    ).toBe('This-2026-06-23-2.csv');
  });

  it('falls back when the first source cannot produce a name', () => {
    const now = new Date(2026, 5, 23, 8, 30);

    expect(buildPastedSourceFileName('////', now, [])).toBe('Pasted Source-2026-06-23.csv');
  });

  it('serializes sources to a two-column CSV with blank targets', () => {
    expect(buildPastedSourceCsv(['A', 'B, C', 'Line 1\nLine 2', 'He said "yes"'])).toBe(
      'Source,Target\r\nA,\r\n"B, C",\r\n"Line 1\nLine 2",\r\n"He said ""yes""",',
    );
  });
});
