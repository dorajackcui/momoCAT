import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CATDatabase } from '../../../../../../../packages/db/src';
import { runTMImportPipeline } from './tmImportPipeline';
import type { TMImportOptions } from '../../../../shared/ipc';

describe('tmImportPipeline', () => {
  let root: string;
  let db: CATDatabase;
  let tmId: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cat-tm-import-'));
    db = new CATDatabase(':memory:');
    tmId = db.createTM('Main TM', 'en', 'fr', 'main');
  });

  afterEach(async () => {
    db.close();
    await rm(root, { recursive: true, force: true });
  });

  function writeWorkbook(fileName: string, rows: unknown[][]): string {
    const filePath = join(root, fileName);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
    XLSX.writeFile(workbook, filePath);
    return filePath;
  }

  function importOptions(overrides: Partial<TMImportOptions> = {}): TMImportOptions {
    return { sourceCol: 0, targetCol: 1, hasHeader: true, overwrite: false, ...overrides };
  }

  function listEntries(): Array<{ source: string; target: string; usageCount: number }> {
    return db
      .listTMEntries(tmId, 500, 0)
      .map((entry) => ({
        source: entry.sourceTokens.map((token) => token.content).join(''),
        target: entry.targetTokens.map((token) => token.content).join(''),
        usageCount: entry.usageCount,
      }))
      .sort((a, b) => a.source.localeCompare(b.source));
  }

  function searchFts(query: string): string[] {
    return db
      .searchConcordance(0, query, [tmId])
      .map((entry) => entry.targetTokens.map((token) => token.content).join(''));
  }

  it('keeps the last occurrence when the file repeats a source', async () => {
    const filePath = writeWorkbook('tm.xlsx', [
      ['source', 'target'],
      ['Hello world', 'Bonjour le monde'],
      ['Open settings', 'Ouvrir les parametres'],
      ['Open settings', 'Ouvrir les parametres v2'],
    ]);

    const result = await runTMImportPipeline(db, {
      tmId,
      filePath,
      options: importOptions(),
    });

    expect(result).toEqual({ success: 2, skipped: 1 });
    expect(listEntries()).toMatchObject([
      { source: 'Hello world', target: 'Bonjour le monde', usageCount: 1 },
      { source: 'Open settings', target: 'Ouvrir les parametres v2', usageCount: 1 },
    ]);
  });

  it('last-wins applies in overwrite mode without inflating usageCount', async () => {
    const filePath = writeWorkbook('tm.xlsx', [
      ['source', 'target'],
      ['Open settings', 'v1'],
      ['Open settings', 'v2'],
      ['Open settings', 'v3'],
    ]);

    const result = await runTMImportPipeline(db, {
      tmId,
      filePath,
      options: importOptions({ overwrite: true }),
    });

    // One unique source: the duplicates collapse before any DB write, so the
    // entry is written once and usageCount reflects a single import.
    expect(result).toEqual({ success: 1, skipped: 2 });
    expect(listEntries()).toMatchObject([{ source: 'Open settings', target: 'v3', usageCount: 1 }]);
  });

  it('without overwrite, existing DB entries win over the file', async () => {
    const firstPath = writeWorkbook('tm-1.xlsx', [
      ['source', 'target'],
      ['Hello world', 'Bonjour le monde'],
    ]);
    await runTMImportPipeline(db, { tmId, filePath: firstPath, options: importOptions() });

    const secondPath = writeWorkbook('tm-2.xlsx', [
      ['source', 'target'],
      ['Hello world', 'Nouvelle traduction'],
      ['Open settings', 'Ouvrir les parametres'],
    ]);
    const result = await runTMImportPipeline(db, {
      tmId,
      filePath: secondPath,
      options: importOptions(),
    });

    expect(result).toEqual({ success: 1, skipped: 1 });
    expect(listEntries()).toMatchObject([
      { source: 'Hello world', target: 'Bonjour le monde' },
      { source: 'Open settings', target: 'Ouvrir les parametres' },
    ]);
  });

  it('with overwrite, the file replaces existing DB entries and rewrites FTS', async () => {
    const firstPath = writeWorkbook('tm-1.xlsx', [
      ['source', 'target'],
      ['Hello world', 'Bonjour le monde'],
    ]);
    await runTMImportPipeline(db, { tmId, filePath: firstPath, options: importOptions() });

    const secondPath = writeWorkbook('tm-2.xlsx', [
      ['source', 'target'],
      ['Hello world', 'Nouvelle traduction'],
    ]);
    const result = await runTMImportPipeline(db, {
      tmId,
      filePath: secondPath,
      options: importOptions({ overwrite: true }),
    });

    expect(result).toEqual({ success: 1, skipped: 0 });
    expect(listEntries()).toMatchObject([{ source: 'Hello world', target: 'Nouvelle traduction' }]);
    expect(searchFts('Hello')).toEqual(['Nouvelle traduction']);
  });

  it('skips rows missing source or target and counts them once', async () => {
    const filePath = writeWorkbook('tm.xlsx', [
      ['source', 'target'],
      ['Hello world', 'Bonjour le monde'],
      ['', 'Sans source'],
      ['Sans cible', ''],
    ]);

    const result = await runTMImportPipeline(db, { tmId, filePath, options: importOptions() });

    expect(result).toEqual({ success: 1, skipped: 2 });
    expect(listEntries()).toHaveLength(1);
  });

  it('last-wins across chunk boundaries keeps one entry and one FTS row', async () => {
    // Chunk size is 800 for files under 100k rows: put the first occurrence
    // in chunk 1 and the winning duplicate in chunk 2.
    const data: string[][] = [
      ['source', 'target'],
      ['Open settings', 'v-first'],
    ];
    for (let i = 0; i < 900; i++) {
      data.push([`Filler row ${i}`, `Remplissage ${i}`]);
    }
    data.push(['Open settings', 'v-last']);
    const filePath = writeWorkbook('tm.xlsx', data);

    const result = await runTMImportPipeline(db, { tmId, filePath, options: importOptions() });

    expect(result).toEqual({ success: 901, skipped: 1 });
    const entry = listEntries().find((e) => e.source === 'Open settings');
    expect(entry).toMatchObject({ target: 'v-last', usageCount: 1 });
    expect(searchFts('settings')).toEqual(['v-last']);
  });

  it('returns zeros for an empty sheet', async () => {
    const filePath = writeWorkbook('tm.xlsx', [['source', 'target']]);
    const result = await runTMImportPipeline(db, { tmId, filePath, options: importOptions() });
    expect(result).toEqual({ success: 0, skipped: 0 });
  });

  it('rejects when the TM does not exist', async () => {
    const filePath = writeWorkbook('tm.xlsx', [['source', 'target']]);
    await expect(
      runTMImportPipeline(db, { tmId: 'missing-tm', filePath, options: importOptions() }),
    ).rejects.toThrow('Target TM not found');
  });

  it('reports monotonically increasing progress percentages', async () => {
    const filePath = writeWorkbook('tm.xlsx', [
      ['source', 'target'],
      ['Hello world', 'Bonjour le monde'],
      ['Open settings', 'Ouvrir les parametres'],
    ]);

    const percents: number[] = [];
    await runTMImportPipeline(
      db,
      { tmId, filePath, options: importOptions() },
      {
        emitProgress: (current, total) => {
          percents.push(total === 0 ? 0 : current / total);
        },
      },
    );

    for (let i = 1; i < percents.length; i++) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]);
    }
    expect(percents[percents.length - 1]).toBe(1);
  });
});
