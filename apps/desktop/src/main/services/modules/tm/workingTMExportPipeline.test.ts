import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { TMEntry, Token } from '@cat/core/models';
import { CATDatabase } from '@cat/db';
import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it } from 'vitest';
import { runTMImportPipeline } from './tmImportPipeline';
import {
  runWorkingTMExportPipeline,
  type WorkingTMExportDatabasePort,
} from './workingTMExportPipeline';
import {
  WORKING_TM_SOURCE_TOKENS_HEADER,
  WORKING_TM_TARGET_TOKENS_HEADER,
} from './workingTMWorkbookFormat';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('runWorkingTMExportPipeline', () => {
  it('reads every page inside one stable database transaction', async () => {
    const entries = Array.from({ length: 1_001 }, (_value, index) => createEntry(index));
    const pageOffsets: number[] = [];
    let inTransaction = false;
    const db: WorkingTMExportDatabasePort = {
      getTM: () => ({ id: 'working-1' }),
      runInTransaction: (fn) => {
        inTransaction = true;
        try {
          return fn();
        } finally {
          inTransaction = false;
        }
      },
      listTMEntries: (_tmId, limit = 500, offset = 0) => {
        expect(inTransaction).toBe(true);
        pageOffsets.push(offset);
        return entries.slice(offset, offset + limit);
      },
    };
    const outputPath = await createOutputPath('snapshot.xlsx');

    await expect(runWorkingTMExportPipeline(db, { tmId: 'working-1', outputPath })).resolves.toBe(
      1_001,
    );

    expect(pageOffsets).toEqual([0, 1_000]);
  });

  it('round-trips literal tag-like text without losing real token identity', async () => {
    const db = new CATDatabase(':memory:');
    const outputPath = await createOutputPath('round-trip.xlsx');
    const sourceTokens: Token[] = [
      { type: 'text', content: 'Literal {1}; real tag: ' },
      { type: 'tag', content: '{1}', meta: { id: '{1}' } },
    ];
    const targetTokens: Token[] = [
      { type: 'text', content: 'Texte {1}; balise réelle : ' },
      { type: 'tag', content: '{1}', meta: { id: '{1}' } },
    ];

    try {
      const sourceTmId = db.createTM('Source Working TM', 'en', 'fr', 'working');
      const entryId = db.upsertTMEntryBySrcHash({
        ...createEntry(1),
        id: 'round-trip-entry',
        tmId: sourceTmId,
        srcHash: 'round-trip-hash',
        sourceTokens,
        targetTokens,
      });
      db.insertTMFts(
        sourceTmId,
        sourceTokens.map((token) => token.content).join(''),
        targetTokens.map((token) => token.content).join(''),
        entryId,
      );

      await runWorkingTMExportPipeline(db, { tmId: sourceTmId, outputPath });

      const workbook = XLSX.readFile(outputPath, { cellStyles: true });
      const worksheet = workbook.Sheets['Working TM'];
      const rows = XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1, raw: false });
      expect(rows[0]).toEqual([
        'Source',
        'Target',
        WORKING_TM_SOURCE_TOKENS_HEADER,
        WORKING_TM_TARGET_TOKENS_HEADER,
      ]);
      expect(rows[1]?.slice(0, 2)).toEqual([
        'Literal {1}; real tag: {1}',
        'Texte {1}; balise réelle : {1}',
      ]);
      expect(worksheet['!cols']?.[2]?.hidden).toBe(true);
      expect(worksheet['!cols']?.[3]?.hidden).toBe(true);

      const importedTmId = db.createTM('Imported Main TM', 'en', 'fr', 'main');
      await runTMImportPipeline(db, {
        tmId: importedTmId,
        filePath: outputPath,
        options: { hasHeader: true, sourceCol: 0, targetCol: 1, overwrite: false },
      });

      const [imported] = db.listTMEntries(importedTmId);
      expect(imported?.sourceTokens).toEqual(sourceTokens);
      expect(imported?.targetTokens).toEqual(targetTokens);
    } finally {
      db.close();
    }
  });
});

function createEntry(index: number): TMEntry & { tmId: string } {
  const now = '2026-08-11T00:00:00.000Z';
  return {
    id: `entry-${index}`,
    tmId: 'working-1',
    projectId: 7,
    srcLang: 'en',
    tgtLang: 'fr',
    srcHash: `hash-${index}`,
    matchKey: `source ${index}`,
    tagsSignature: '',
    sourceTokens: [{ type: 'text', content: `Source ${index}` }],
    targetTokens: [{ type: 'text', content: `Target ${index}` }],
    createdAt: now,
    updatedAt: now,
    usageCount: 1,
  };
}

async function createOutputPath(filename: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'momocat-working-tm-export-'));
  temporaryDirectories.push(directory);
  return join(directory, filename);
}
