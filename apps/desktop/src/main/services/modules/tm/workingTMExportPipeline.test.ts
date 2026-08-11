import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { TMEntry, Token } from '@cat/core/models';
import { CATDatabase } from '@cat/db';
import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it } from 'vitest';
import {
  runWorkingTMExportPipeline,
  type WorkingTMExportDatabasePort,
} from './workingTMExportPipeline';

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

  it('exports original tag text in two columns without editor markers', async () => {
    const db = new CATDatabase(':memory:');
    const outputPath = await createOutputPath('original-tags.xlsx');
    const sourceTokens: Token[] = [
      { type: 'text', content: 'Literal {1}; real tag: ' },
      { type: 'tag', content: '<b>', meta: { id: '<b>' } },
      { type: 'text', content: 'bold' },
      { type: 'tag', content: '</b>', meta: { id: '</b>' } },
    ];
    const targetTokens: Token[] = [
      { type: 'text', content: 'Texte {1}; balise réelle : ' },
      { type: 'tag', content: '<b>', meta: { id: '<b>' } },
      { type: 'text', content: 'gras' },
      { type: 'tag', content: '</b>', meta: { id: '</b>' } },
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

      const workbook = XLSX.readFile(outputPath);
      const worksheet = workbook.Sheets['Working TM'];
      const rows = XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1, raw: false });
      expect(rows).toEqual([
        ['Source', 'Target'],
        ['Literal {1}; real tag: <b>bold</b>', 'Texte {1}; balise réelle : <b>gras</b>'],
      ]);
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
