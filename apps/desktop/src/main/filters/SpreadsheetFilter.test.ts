import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { SpreadsheetFilter } from './SpreadsheetFilter';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createWorkbook(rows: string[][]): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'momocat-spreadsheet-filter-'));
  tempDirs.push(tempDir);

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');

  const filePath = join(tempDir, 'import.xlsx');
  XLSX.writeFile(workbook, filePath);
  return filePath;
}

describe('SpreadsheetFilter.import', () => {
  it('protects marker-like text as tag tokens by default', async () => {
    const markerText = 'Save {1} <xxx> %s';
    const filePath = await createWorkbook([
      ['Source', 'Target'],
      [markerText, markerText],
    ]);

    const [segment] = await new SpreadsheetFilter().import(filePath, 1, 2, {
      hasHeader: true,
      sourceCol: 0,
      targetCol: 1,
    });

    expect(segment.sourceTokens.some((token) => token.type === 'tag')).toBe(true);
    expect(segment.targetTokens.some((token) => token.type === 'tag')).toBe(true);
    expect(segment.tagsSignature).toContain('{1}');
    expect(segment.tagsSignature).toContain('<xxx>');
    expect(segment.tagsSignature).toContain('%s');
  });

  it('keeps marker-like text as plain text when tagPolicy is none', async () => {
    const markerText = 'Save {1} <xxx> %s';
    const filePath = await createWorkbook([
      ['Source', 'Target'],
      [markerText, markerText],
    ]);

    const [segment] = await new SpreadsheetFilter().import(filePath, 1, 2, {
      hasHeader: true,
      sourceCol: 0,
      targetCol: 1,
      tagPolicy: 'none',
    });

    expect(segment.sourceTokens).toEqual([{ type: 'text', content: markerText }]);
    expect(segment.targetTokens).toEqual([{ type: 'text', content: markerText }]);
    expect(segment.tagsSignature).toBe('');
    expect(segment.matchKey).toBe('save {1} <xxx> %s');
  });
});
