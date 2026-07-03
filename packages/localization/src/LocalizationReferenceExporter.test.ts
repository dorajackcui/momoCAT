import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { TMEntry } from '@cat/core/models';
import { serializeTokensToDisplayText } from '@cat/core/text';
import { CATDatabase } from '../../db/src';
import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import { LocalizationReferenceExporter } from './LocalizationReferenceExporter';
import { SqliteProjectRepository } from './adapters/sqlite/SqliteProjectRepository';
import { SqliteTBRepository } from './adapters/sqlite/SqliteTBRepository';
import { SqliteTMRepository } from './adapters/sqlite/SqliteTMRepository';
import { TBModule } from './modules/TBModule';
import { TMModule } from './modules/TMModule';
import { TBService } from './services/TBService';
import { TMService } from './services/TMService';
import { createTransientSegment } from './transientSegment';

describe('LocalizationReferenceExporter.exportReferencesForMtFile', () => {
  it('exports source-only TM/TB references without full inspect artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-reference-export-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Reference Export', 'en', 'fr');
      mountDistinctReferenceData(db, projectId);
      const inputPath = writeInputWorkbook(root, [
        ['source', 'target'],
        ['Hello world', ''],
        ['Preferences', 'Existing target'],
      ]);
      const outputPath = join(root, 'references.xlsx');
      const progress: Array<[number, number]> = [];
      const exporter = new LocalizationReferenceExporter(db, {});

      const result = await exporter.exportReferencesForMtFile({
        projectId,
        inputPath,
        outputPath,
        maxConcurrency: 2,
        onProgress: (current, total) => progress.push([current, total]),
      });

      expect(result).toMatchObject({
        outputPath,
        summary: { total: 2, ready: 2, error: 0 },
      });
      expect(progress).toEqual([
        [0, 2],
        [1, 2],
        [2, 2],
      ]);

      const written = XLSX.read(await readFile(outputPath), { type: 'buffer' });
      expect(written.SheetNames).toEqual(['Sheet1']);

      const rows = XLSX.utils.sheet_to_json(written.Sheets.Sheet1, {
        header: 1,
        defval: '',
      }) as string[][];
      expect(rows[0]).toEqual(['source', 'target', '_tm_for_mt', '_tb_for_mt']);
      expect(rows[1][2]).toContain('Bonjour le monde');
      expect(rows[1][2]).not.toContain('Reglages');
      expect(rows[1][3]).toContain('world -> monde');
      expect(rows[1][3]).not.toContain('Preferences -> Reglages');
      expect(rows[2][2]).toContain('Reglages');
      expect(rows[2][2]).not.toContain('Bonjour le monde');
      expect(rows[2][3]).toContain('Preferences -> Reglages');
      expect(rows[2][3]).not.toContain('world -> monde');
      expect(rows[0]).not.toContain('_mt_user_prompt');
      expect(rows[0]).not.toContain('_inspect_json_ref');
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('runs TM/TB lookups once per unique source and reuses results for duplicate rows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-reference-export-dedupe-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Reference Export Dedupe', 'en', 'fr');
      mountDistinctReferenceData(db, projectId);
      const inputPath = writeInputWorkbook(root, [
        ['source', 'target'],
        ['Hello world', ''],
        ['Hello world', 'Existing target'],
        ['Preferences', ''],
      ]);
      const outputPath = join(root, 'references.xlsx');

      const projectRepo = new SqliteProjectRepository(db);
      const tmRepo = new SqliteTMRepository(db);
      const tbRepo = new SqliteTBRepository(db);
      const tmService = new TMService(projectRepo, tmRepo);
      const tbService = new TBService(projectRepo, tbRepo);
      const tmFindMatches = vi.fn(tmService.findMatches.bind(tmService));
      const tbFindMatches = vi.fn(tbService.findMatches.bind(tbService));
      const exporter = new LocalizationReferenceExporter(db, {
        tmModule: new TMModule({ tmRepo, tmService: { findMatches: tmFindMatches } }),
        tbModule: new TBModule({ tbRepo, tbService: { findMatches: tbFindMatches } }),
      });

      const progress: Array<[number, number]> = [];
      const result = await exporter.exportReferencesForMtFile({
        projectId,
        inputPath,
        outputPath,
        onProgress: (current, total) => progress.push([current, total]),
      });

      expect(result.summary).toEqual({ total: 3, ready: 3, error: 0 });
      expect(tmFindMatches).toHaveBeenCalledTimes(2);
      expect(tbFindMatches).toHaveBeenCalledTimes(2);
      expect(progress[0]).toEqual([0, 3]);
      expect(progress[progress.length - 1]).toEqual([3, 3]);

      const written = XLSX.read(await readFile(outputPath), { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(written.Sheets.Sheet1, {
        header: 1,
        defval: '',
      }) as string[][];
      expect(rows[1][2]).toContain('Bonjour le monde');
      expect(rows[2][2]).toBe(rows[1][2]);
      expect(rows[2][3]).toBe(rows[1][3]);
      expect(rows[3][2]).toContain('Reglages');

      // Duplicate rows keep their own unit identity on the shared artifacts.
      for (const unit of result.units) {
        expect(unit.tm.unitId).toBe(unit.unit.unitId);
        expect(unit.tb.unitId).toBe(unit.unit.unitId);
        expect(unit.tm.segmentId).toBe(unit.transientSegment.segmentId);
        expect(unit.tb.segmentId).toBe(unit.transientSegment.segmentId);
      }
      expect(new Set(result.units.map((unit) => unit.unit.unitId)).size).toBe(3);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

function writeInputWorkbook(root: string, rows: unknown[][]): string {
  const inputPath = join(root, `input-${Math.random().toString(16).slice(2)}.xlsx`);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  XLSX.writeFile(workbook, inputPath);
  return inputPath;
}

function mountDistinctReferenceData(db: CATDatabase, projectId: number): void {
  const tmId = db.createTM('Client Main TM', 'en', 'fr', 'main');
  db.mountTMToProject(projectId, tmId, 10, 'read');

  for (const [sourceText, targetText] of [
    ['Hello world', 'Bonjour le monde'],
    ['Preferences', 'Reglages'],
  ] as const) {
    const entry = createTMEntry({ tmId, projectId, sourceText, targetText });
    const entryId = db.upsertTMEntryBySrcHash(entry);
    db.replaceTMFts(
      tmId,
      serializeTokensToDisplayText(entry.sourceTokens),
      serializeTokensToDisplayText(entry.targetTokens),
      entryId,
    );
  }

  const tbId = db.createTermBase('Client Terms', 'en', 'fr');
  db.mountTermBaseToProject(projectId, tbId, 20);
  db.insertTBEntryIfAbsentBySrcTerm({
    id: 'term-world',
    tbId,
    srcLang: 'en',
    srcTerm: 'world',
    tgtTerm: 'monde',
    note: 'Use the common noun.',
  });
  db.insertTBEntryIfAbsentBySrcTerm({
    id: 'term-preferences',
    tbId,
    srcLang: 'en',
    srcTerm: 'Preferences',
    tgtTerm: 'Reglages',
    note: 'Use UI noun.',
  });
}

function createTMEntry(params: {
  tmId: string;
  projectId: number;
  sourceText: string;
  targetText: string;
}): TMEntry & { tmId: string } {
  const transient = createTransientSegment(
    {
      id: `seed-${params.sourceText}`,
      source: params.sourceText,
      target: params.targetText,
    },
    0,
  );
  const now = new Date().toISOString();

  return {
    id: `tm-${transient.srcHash}`,
    tmId: params.tmId,
    projectId: params.projectId,
    srcLang: 'en',
    tgtLang: 'fr',
    srcHash: transient.srcHash,
    matchKey: transient.matchKey,
    tagsSignature: transient.tagsSignature,
    sourceTokens: transient.sourceTokens,
    targetTokens: transient.targetTokens,
    usageCount: 1,
    createdAt: now,
    updatedAt: now,
  };
}
