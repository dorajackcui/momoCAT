import { mkdtemp, rm, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CATDatabase } from '../../../../../../../packages/db/src';
import {
  runTMSyncPipeline,
  type TMSyncDatabasePort,
  type TMSyncPipelineInput,
} from './tmSyncPipeline';

describe('tmSyncPipeline', () => {
  let root: string;
  let db: CATDatabase;
  let tmId: string;
  let projectId: number;
  let runCounter = 0;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cat-tm-sync-'));
    db = new CATDatabase(':memory:');
    projectId = db.createProject('Sync Project', 'en', 'fr');
    tmId = db.createTM('Main TM', 'en', 'fr', 'main');
    db.mountTMToProject(projectId, tmId, 10, 'read');
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

  function syncInput(
    filePath: string,
    overrides: Partial<TMSyncPipelineInput> = {},
  ): TMSyncPipelineInput {
    runCounter += 1;
    return {
      tmId,
      filePath,
      columns: { sourceCol: 0, targetCol: 1, hasHeader: true },
      deletePolicy: 'never',
      syncRunId: `run-${runCounter}`,
      ...overrides,
    };
  }

  function listEntries(): Array<{
    source: string;
    target: string;
    updatedAt: string;
    usageCount: number;
  }> {
    return db
      .listTMEntries(tmId, 500, 0)
      .map((entry) => ({
        source: entry.sourceTokens.map((token) => token.content).join(''),
        target: entry.targetTokens.map((token) => token.content).join(''),
        updatedAt: entry.updatedAt,
        usageCount: entry.usageCount,
      }))
      .sort((a, b) => a.source.localeCompare(b.source));
  }

  it('adds all rows on first sync, counting skips and duplicates', async () => {
    const filePath = writeWorkbook('tm.xlsx', [
      ['source', 'target'],
      ['Hello world', 'Bonjour le monde'],
      ['Open settings', 'Ouvrir les parametres'],
      ['Open settings', 'Ouvrir les parametres v2'], // duplicate source, last wins
      ['No target', ''],
    ]);

    const report = await runTMSyncPipeline(db, syncInput(filePath));

    expect(report).toMatchObject({
      fileRows: 4,
      skipped: 1,
      duplicates: 1,
      added: 2,
      updated: 0,
      deleted: 0,
      unchanged: 0,
    });
    expect(listEntries()).toMatchObject([
      { source: 'Hello world', target: 'Bonjour le monde', usageCount: 0 },
      { source: 'Open settings', target: 'Ouvrir les parametres v2', usageCount: 0 },
    ]);
    // Staging is cleaned up after the run.
    expect(db.countTMSyncStagedRows('run-1')).toBe(0);
  });

  it('re-syncing an unchanged file writes nothing', async () => {
    const filePath = writeWorkbook('tm.xlsx', [
      ['source', 'target'],
      ['Hello world', 'Bonjour le monde'],
      ['Open settings', 'Ouvrir les parametres'],
    ]);
    await runTMSyncPipeline(db, syncInput(filePath));
    const before = listEntries();

    const report = await runTMSyncPipeline(db, syncInput(filePath));

    expect(report).toMatchObject({ added: 0, updated: 0, deleted: 0, unchanged: 2 });
    // Zero writes: updatedAt of every entry is untouched.
    expect(listEntries()).toEqual(before);
  });

  it('applies only the changed row and keeps usage metadata', async () => {
    const filePath = writeWorkbook('tm.xlsx', [
      ['source', 'target'],
      ['Hello world', 'Bonjour le monde'],
      ['Open settings', 'Ouvrir les parametres'],
    ]);
    await runTMSyncPipeline(db, syncInput(filePath));
    const before = listEntries();

    await unlink(filePath);
    const updatedPath = writeWorkbook('tm.xlsx', [
      ['source', 'target'],
      ['Hello world', 'Bonjour tout le monde'],
      ['Open settings', 'Ouvrir les parametres'],
    ]);

    const report = await runTMSyncPipeline(db, syncInput(updatedPath));

    expect(report).toMatchObject({ added: 0, updated: 1, deleted: 0, unchanged: 1 });
    const after = listEntries();
    expect(after[0].target).toBe('Bonjour tout le monde');
    expect(after[0].usageCount).toBe(0);
    // The untouched entry keeps its updatedAt.
    expect(after[1]).toEqual(before[1]);
    // Concordance follows the new target.
    expect(db.searchConcordance(projectId, 'Bonjour tout le monde', [tmId]).length).toBeGreaterThan(
      0,
    );
  });

  it("deletePolicy 'never' keeps entries missing from the file; 'prune-all' removes them", async () => {
    const filePath = writeWorkbook('tm.xlsx', [
      ['source', 'target'],
      ['Hello world', 'Bonjour le monde'],
      ['Legacy entry', 'Entree historique'],
    ]);
    await runTMSyncPipeline(db, syncInput(filePath));

    await unlink(filePath);
    const shrunkPath = writeWorkbook('tm.xlsx', [
      ['source', 'target'],
      ['Hello world', 'Bonjour le monde'],
    ]);

    const keepReport = await runTMSyncPipeline(db, syncInput(shrunkPath));
    expect(keepReport.deleted).toBe(0);
    expect(keepReport.deletedLocalEdits).toBe(0);
    expect(listEntries()).toHaveLength(2);

    const pruneReport = await runTMSyncPipeline(
      db,
      syncInput(shrunkPath, { deletePolicy: 'prune-all' }),
    );
    expect(pruneReport.deleted).toBe(1);
    expect(listEntries()).toMatchObject([{ source: 'Hello world' }]);
    expect(db.searchConcordance(projectId, 'Entree historique', [tmId])).toHaveLength(0);
  });

  it('a prune run reports locally edited entries it deletes', async () => {
    const filePath = writeWorkbook('tm.xlsx', [
      ['source', 'target'],
      ['Hello world', 'Bonjour le monde'],
      ['Legacy entry', 'Entree historique'],
    ]);
    await runTMSyncPipeline(db, syncInput(filePath));

    // Local edit after the last sync; the entry is then removed from the file.
    const legacy = db
      .listTMEntries(tmId, 10, 0)
      .find(
        (entry) => entry.sourceTokens.map((token) => token.content).join('') === 'Legacy entry',
      );
    db.runInTransaction(() =>
      db.applyTMSyncUpdates(tmId, [
        {
          entryId: legacy!.id,
          sourceTokensJson: JSON.stringify(legacy!.sourceTokens),
          targetTokensJson: JSON.stringify([{ type: 'text', content: 'Edition locale' }]),
          srcText: 'Legacy entry',
          tgtText: 'Edition locale',
        },
      ]),
    );

    await unlink(filePath);
    const shrunkPath = writeWorkbook('tm.xlsx', [
      ['source', 'target'],
      ['Hello world', 'Bonjour le monde'],
    ]);

    const pruneReport = await runTMSyncPipeline(
      db,
      syncInput(shrunkPath, {
        deletePolicy: 'prune-all',
        lastSyncedAt: '2020-01-01T00:00:00.000Z',
      }),
    );

    expect(pruneReport.deleted).toBe(1);
    expect(pruneReport.deletedLocalEdits).toBe(1);
    expect(listEntries()).toMatchObject([{ source: 'Hello world' }]);
  });

  it('cancellation before apply leaves the TM untouched and reports cancelled', async () => {
    const filePath = writeWorkbook('tm.xlsx', [
      ['source', 'target'],
      ['Hello world', 'Bonjour le monde'],
    ]);

    const report = await runTMSyncPipeline(db, syncInput(filePath), {
      isCancelled: () => true,
    });

    expect(report.cancelled).toBe(true);
    expect(listEntries()).toHaveLength(0);
  });

  it('a failed run leaves a consistent prefix and re-running converges', async () => {
    const filePath = writeWorkbook('tm.xlsx', [
      ['source', 'target'],
      ['Alpha row', 'Ligne alpha'],
      ['Beta row', 'Ligne beta'],
      ['Gamma row', 'Ligne gamma'],
    ]);

    let insertCalls = 0;
    const failingDb: TMSyncDatabasePort = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'listTMSyncNewRows') {
          // Page size 1 so the failure hits mid-apply.
          return (runId: string, tm: string, after: string) =>
            target.listTMSyncNewRows(runId, tm, after, 1);
        }
        if (prop === 'applyTMSyncInserts') {
          return (tm: string, rows: Parameters<CATDatabase['applyTMSyncInserts']>[1]) => {
            insertCalls += 1;
            if (insertCalls === 2) throw new Error('Forced insert failure');
            return target.applyTMSyncInserts(tm, rows);
          };
        }
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    }) as unknown as TMSyncDatabasePort;

    await expect(runTMSyncPipeline(failingDb, syncInput(filePath))).rejects.toThrow(
      'Forced insert failure',
    );
    // Exactly the first page was applied; entry + FTS stayed paired.
    expect(listEntries()).toHaveLength(1);

    const report = await runTMSyncPipeline(db, syncInput(filePath));
    expect(report.added).toBe(2);
    expect(report.unchanged).toBe(1);
    expect(listEntries()).toHaveLength(3);
  });

  it('counts overwritten local edits against lastSyncedAt', async () => {
    const filePath = writeWorkbook('tm.xlsx', [
      ['source', 'target'],
      ['Hello world', 'Bonjour le monde'],
    ]);
    await runTMSyncPipeline(db, syncInput(filePath));

    // Local edit after the last sync.
    const entry = db.listTMEntries(tmId, 10, 0)[0];
    db.runInTransaction(() =>
      db.applyTMSyncUpdates(tmId, [
        {
          entryId: entry.id,
          sourceTokensJson: JSON.stringify(entry.sourceTokens),
          targetTokensJson: JSON.stringify([{ type: 'text', content: 'Edition locale' }]),
          srcText: 'Hello world',
          tgtText: 'Edition locale',
        },
      ]),
    );

    const report = await runTMSyncPipeline(
      db,
      syncInput(filePath, { lastSyncedAt: '2020-01-01T00:00:00.000Z' }),
    );

    expect(report.updated).toBe(1);
    expect(report.overwrittenLocalEdits).toBe(1);
    expect(listEntries()[0].target).toBe('Bonjour le monde');
  });

  it('rejects when the TM does not exist', async () => {
    const filePath = writeWorkbook('tm.xlsx', [['source', 'target']]);
    await expect(
      runTMSyncPipeline(db, syncInput(filePath, { tmId: 'missing-tm' })),
    ).rejects.toThrow('Target TM not found');
  });

  it('syncs source-display changes that keep the same srcHash', async () => {
    const filePath = writeWorkbook('tm.xlsx', [
      ['source', 'target'],
      ['Hello world', 'Bonjour le monde'],
    ]);
    await runTMSyncPipeline(db, syncInput(filePath));

    // matchKey lowercases and collapses whitespace, so the srcHash is
    // unchanged — only the display form differs.
    await unlink(filePath);
    const shoutingPath = writeWorkbook('tm.xlsx', [
      ['source', 'target'],
      ['HELLO WORLD', 'Bonjour le monde'],
    ]);

    const report = await runTMSyncPipeline(db, syncInput(shoutingPath));

    expect(report).toMatchObject({ added: 0, updated: 1, deleted: 0, unchanged: 0 });
    const entries = listEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe('HELLO WORLD');
    expect(entries[0].target).toBe('Bonjour le monde');

    // Converged: the next sync is a no-op.
    const rerun = await runTMSyncPipeline(db, syncInput(shoutingPath));
    expect(rerun).toMatchObject({ updated: 0, unchanged: 1 });
  });

  it('leaves a concurrent run of another TM staged while this TM syncs', async () => {
    const otherTmId = db.createTM('Other TM', 'en', 'fr', 'main');
    db.runInTransaction(() =>
      db.stageTMSyncRows('run-other', otherTmId, [
        {
          srcHash: 'hash-other',
          matchKey: 'other',
          tagsSignature: '',
          sourceTokensJson: JSON.stringify([{ type: 'text', content: 'Other' }]),
          targetTokensJson: JSON.stringify([{ type: 'text', content: 'Autre' }]),
          srcText: 'Other',
          tgtText: 'Autre',
        },
      ]),
    );

    const filePath = writeWorkbook('tm.xlsx', [
      ['source', 'target'],
      ['Hello world', 'Bonjour le monde'],
    ]);
    const report = await runTMSyncPipeline(db, syncInput(filePath));
    expect(report.added).toBe(1);

    // The other TM's in-flight staging survived this run's cleanup.
    expect(db.countTMSyncStagedRows('run-other')).toBe(1);
  });
});
