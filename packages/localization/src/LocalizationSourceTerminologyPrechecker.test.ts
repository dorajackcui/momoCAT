import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { CATDatabase } from '../../db/src';
import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import { LocalizationSourceTerminologyPrechecker } from './LocalizationSourceTerminologyPrechecker';

describe('LocalizationSourceTerminologyPrechecker', () => {
  it('exports per-row source terms and a globally deduplicated summary sheet', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-source-term-precheck-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Source Terms', 'en', 'fr');
      db.setSetting('source_terminology_selection_prompt_v1', 'Prefer named UI concepts.');
      const tbId = db.createTermBase('History', 'en', 'fr');
      db.mountTermBaseToProject(projectId, tbId, 10);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'term-account',
        tbId,
        srcLang: 'en',
        srcTerm: 'Account',
        tgtTerm: 'Compte',
      });
      const inputPath = join(root, 'input.xlsx');
      const outputPath = join(root, 'precheck.xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['source', 'target'],
          ['Open Account Settings', ''],
          ['Recovery Code', ''],
        ]),
        'Sheet1',
      );
      XLSX.writeFile(workbook, inputPath);

      const extract = vi.fn(async (input) => {
        expect(input.units[0].historicalTerms).toEqual([
          expect.objectContaining({ sourceTerm: 'Account', targetTerm: 'Compte' }),
        ]);
        return {
          units: input.units.map((unit) => ({
            ...unit,
            sourceTerms: unit.source.includes('Settings')
              ? ['Account Settings']
              : ['Recovery Code'],
            status: 'ready' as const,
          })),
          terms: [
            {
              sourceTerm: 'Account Settings',
              variants: [],
              occurrences: 1,
              documentUnitIds: [`${input.units[0].documentId}\u001f${input.units[0].unitId}`],
              rowNumbers: [2],
              sampleSources: ['Open Account Settings'],
              status: 'candidate' as const,
            },
            {
              sourceTerm: 'Recovery Code',
              variants: [],
              occurrences: 1,
              documentUnitIds: [`${input.units[1].documentId}\u001f${input.units[1].unitId}`],
              rowNumbers: [3],
              sampleSources: ['Recovery Code'],
              status: 'candidate' as const,
            },
          ],
          summary: { total: 2, ready: 2, error: 0, cancelled: 0, uniqueTerms: 2 },
        };
      });
      const prechecker = new LocalizationSourceTerminologyPrechecker(db, {
        extractor: { extract },
      });

      const result = await prechecker.precheckFile({
        projectId,
        inputPath,
        outputPath,
        maxConcurrency: 2,
      });

      expect(extract).toHaveBeenCalledWith(
        expect.objectContaining({
          selectionPrompt: 'Prefer named UI concepts.',
          options: expect.objectContaining({ maxConcurrency: 2 }),
        }),
      );
      expect(result.summary).toEqual({
        total: 2,
        ready: 2,
        error: 0,
        cancelled: 0,
        uniqueTerms: 2,
      });
      const written = XLSX.read(await readFile(outputPath), { type: 'buffer' });
      expect(written.SheetNames).toEqual(['Sheet1', 'New_Terms']);
      const segmentRows = XLSX.utils.sheet_to_json(written.Sheets.Sheet1, {
        header: 1,
        defval: '',
      }) as string[][];
      expect(segmentRows[0]).toEqual([
        'source',
        'target',
        '_historical_tb',
        '_new_source_terms',
        '_term_precheck_status',
        '_term_precheck_error',
      ]);
      expect(segmentRows[1][2]).toContain('Account -> Compte');
      expect(segmentRows[1][3]).toBe('Account Settings');
      const termRows = XLSX.utils.sheet_to_json(written.Sheets.New_Terms, {
        header: 1,
        defval: '',
      }) as Array<Array<string | number>>;
      expect(termRows[0]).toEqual([
        'source_term',
        'variants',
        'occurrences',
        'rows',
        'sample_sources',
        'status',
      ]);
      expect(termRows[1]).toEqual([
        'Account Settings',
        '',
        1,
        '2',
        'Open Account Settings',
        'candidate',
      ]);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes a per-row error when historical TB lookup fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-source-term-precheck-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Source Terms', 'en', 'fr');
      const inputPath = join(root, 'input.xlsx');
      const outputPath = join(root, 'precheck.xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['source', 'target'],
          ['Recovery Code', ''],
        ]),
        'Sheet1',
      );
      XLSX.writeFile(workbook, inputPath);
      const extract = vi.fn();
      const prechecker = new LocalizationSourceTerminologyPrechecker(db, {
        tbModule: { inspect: vi.fn().mockRejectedValue(new Error('TB lookup unavailable')) },
        extractor: { extract },
      });

      const result = await prechecker.precheckFile({ projectId, inputPath, outputPath });

      expect(extract).not.toHaveBeenCalled();
      expect(result.summary).toEqual({
        total: 1,
        ready: 0,
        error: 1,
        cancelled: 0,
        uniqueTerms: 0,
      });
      const written = XLSX.read(await readFile(outputPath), { type: 'buffer' });
      const segmentRows = XLSX.utils.sheet_to_json(written.Sheets.Sheet1, {
        header: 1,
        defval: '',
      }) as string[][];
      expect(segmentRows[1][4]).toBe('error');
      expect(segmentRows[1][5]).toBe('TB lookup unavailable');
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('stops after spreadsheet parsing and writes cancelled rows without TB or provider work', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-source-term-precheck-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Source Terms', 'en', 'fr');
      const inputPath = join(root, 'input.xlsx');
      const outputPath = join(root, 'precheck.xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['source', 'target'],
          ['FeatureName1', ''],
          ['FeatureName2', ''],
        ]),
        'Sheet1',
      );
      XLSX.writeFile(workbook, inputPath);
      const inspect = vi.fn();
      const extract = vi.fn();
      const prechecker = new LocalizationSourceTerminologyPrechecker(db, {
        tbModule: { inspect },
        extractor: { extract },
      });

      const result = await prechecker.precheckFile({
        projectId,
        inputPath,
        outputPath,
        cancellationToken: { isCancellationRequested: () => true },
      });

      expect(inspect).not.toHaveBeenCalled();
      expect(extract).not.toHaveBeenCalled();
      expect(result.summary).toEqual({
        total: 2,
        ready: 0,
        error: 0,
        cancelled: 2,
        uniqueTerms: 0,
      });
      const written = XLSX.read(await readFile(outputPath), { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(written.Sheets.Sheet1, {
        header: 1,
        defval: '',
      }) as string[][];
      expect(rows.slice(1).map((row) => row[4])).toEqual(['cancelled', 'cancelled']);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes completed results and marks unfinished rows as cancelled in partial output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-source-term-precheck-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Source Terms', 'en', 'fr');
      const inputPath = join(root, 'input.xlsx');
      const outputPath = join(root, 'precheck.xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['source', 'target'],
          ['FeatureName1', ''],
          ['FeatureName2', ''],
        ]),
        'Sheet1',
      );
      XLSX.writeFile(workbook, inputPath);
      const extract = vi.fn(async (input) => ({
        units: [
          { ...input.units[0], sourceTerms: ['FeatureName1'], status: 'ready' as const },
          { ...input.units[1], sourceTerms: [], status: 'cancelled' as const },
        ],
        terms: [
          {
            sourceTerm: 'FeatureName1',
            variants: [],
            occurrences: 1,
            documentUnitIds: [`${input.units[0].documentId}\u001f${input.units[0].unitId}`],
            rowNumbers: [2],
            sampleSources: ['FeatureName1'],
            status: 'candidate' as const,
          },
        ],
        summary: { total: 2, ready: 1, error: 0, cancelled: 1, uniqueTerms: 1 },
      }));
      const prechecker = new LocalizationSourceTerminologyPrechecker(db, {
        extractor: { extract },
      });

      const result = await prechecker.precheckFile({
        projectId,
        inputPath,
        outputPath,
        cancellationToken: { isCancellationRequested: () => false },
      });

      expect(extract).toHaveBeenCalledWith(
        expect.objectContaining({ cancellationToken: expect.any(Object) }),
      );
      expect(result.summary).toEqual({
        total: 2,
        ready: 1,
        error: 0,
        cancelled: 1,
        uniqueTerms: 1,
      });
      const written = XLSX.read(await readFile(outputPath), { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(written.Sheets.Sheet1, {
        header: 1,
        defval: '',
      }) as string[][];
      expect(rows[1][3]).toBe('FeatureName1');
      expect(rows[1][4]).toBe('ready');
      expect(rows[2][4]).toBe('cancelled');
      expect(written.SheetNames).toContain('New_Terms');
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
