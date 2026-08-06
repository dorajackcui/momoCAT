import { describe, expect, it } from 'vitest';
import { normalizeProjectFileName } from './projectFileName';

describe('normalizeProjectFileName', () => {
  it('normalizes base-name whitespace and a repeated extension', () => {
    expect(normalizeProjectFileName('original.xlsx', '  renamed .xlsx  ')).toBe('renamed.xlsx');
    expect(normalizeProjectFileName('original.xlsx', 'renamed.xlsx.xlsx')).toBe('renamed.xlsx');
  });

  it('preserves the original extension casing', () => {
    expect(normalizeProjectFileName('original.XLSX', 'renamed.xlsx')).toBe('renamed.XLSX');
  });

  it('rejects empty, unsafe, and changed-extension names', () => {
    expect(() => normalizeProjectFileName('original.xlsx', '   ')).toThrow(
      'File name cannot be empty.',
    );
    expect(() => normalizeProjectFileName('original.xlsx', '../renamed.xlsx')).toThrow(
      'File name contains invalid characters.',
    );
    expect(() => normalizeProjectFileName('original.xlsx', 'renamed.csv')).toThrow(
      'File extension must remain ".xlsx".',
    );
  });
});
