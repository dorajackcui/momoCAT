import { mkdtemp, rm, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATDatabase } from '../../../../../../packages/db/src';
import { TBModule } from './TBModule';
import { TBService } from '../TBService';
import { SqliteProjectRepository } from '../adapters/SqliteProjectRepository';
import { SqliteSettingsRepository } from '../adapters/SqliteSettingsRepository';
import { SqliteTBRepository } from '../adapters/SqliteTBRepository';
import { SqliteTransactionManager } from '../adapters/SqliteTransactionManager';

describe('TBModule sync with local Excel', () => {
  let root: string;
  let db: CATDatabase;
  let tbModule: TBModule;
  let tbRepo: SqliteTBRepository;
  let emitProgress: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cat-tb-sync-'));
    db = new CATDatabase(':memory:');
    tbRepo = new SqliteTBRepository(db);
    const projectRepo = new SqliteProjectRepository(db);
    const settingsRepo = new SqliteSettingsRepository(db);
    const tx = new SqliteTransactionManager(db);
    emitProgress = vi.fn();
    tbModule = new TBModule(
      tbRepo,
      tx,
      new TBService(projectRepo, tbRepo),
      emitProgress,
      settingsRepo,
    );
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

  function listTerms(
    tbId: string,
  ): Array<{ srcTerm: string; tgtTerm: string; note: string | null }> {
    return tbRepo
      .listTBEntries(tbId, 500, 0)
      .map(({ srcTerm, tgtTerm, note }) => ({ srcTerm, tgtTerm, note: note ?? null }));
  }

  it('stores and exposes the sync config through listTBs', async () => {
    const tbId = db.createTermBase('Synced Glossary', 'en', 'fr');
    await tbModule.setTBSyncConfig(tbId, {
      filePath: join(root, 'terms.xlsx'),
      columns: { hasHeader: true, sourceCol: 0, targetCol: 1, noteCol: 2 },
    });

    const tbs = await tbModule.listTBs();
    const synced = tbs.find((tb) => tb.id === tbId);
    expect(synced?.syncConfig).toMatchObject({
      filePath: join(root, 'terms.xlsx'),
      columns: { hasHeader: true, sourceCol: 0, targetCol: 1, noteCol: 2 },
    });

    const plainId = db.createTermBase('Plain', 'en', 'fr');
    const plain = (await tbModule.listTBs()).find((tb) => tb.id === plainId);
    expect(plain?.syncConfig).toBeNull();
  });

  it('mirrors the Excel contents on sync: adds, updates, and removes entries', async () => {
    const tbId = db.createTermBase('Synced Glossary', 'en', 'fr');
    const filePath = writeWorkbook('terms.xlsx', [
      ['source', 'target', 'note'],
      ['world', 'monde', 'common noun'],
      ['settings', 'parametres', ''],
    ]);
    await tbModule.setTBSyncConfig(tbId, {
      filePath,
      columns: { hasHeader: true, sourceCol: 0, targetCol: 1, noteCol: 2 },
    });

    // Pre-existing entries: one stale manual term and one term that changes target.
    db.insertTBEntryIfAbsentBySrcTerm({
      id: 'manual-1',
      tbId,
      srcLang: 'en',
      srcTerm: 'stale',
      tgtTerm: 'perime',
    });
    db.insertTBEntryIfAbsentBySrcTerm({
      id: 'manual-2',
      tbId,
      srcLang: 'en',
      srcTerm: 'world',
      tgtTerm: 'ancienne-traduction',
    });

    const result = await tbModule.syncTBEntriesFromExcel(tbId);

    expect(result).toEqual({ success: 2, skipped: 0, removed: 2 });
    expect(listTerms(tbId).sort((a, b) => a.srcTerm.localeCompare(b.srcTerm))).toEqual([
      { srcTerm: 'settings', tgtTerm: 'parametres', note: null },
      { srcTerm: 'world', tgtTerm: 'monde', note: 'common noun' },
    ]);

    const config = tbModule.getTBSyncConfig(tbId);
    expect(config?.lastSyncStatus).toBe('success');
    expect(config?.lastSyncedAt).toBeTruthy();
    expect(config?.lastSyncError).toBeUndefined();

    expect(emitProgress).toHaveBeenCalledWith(expect.objectContaining({ type: 'tb-sync' }));
  });

  it('reflects deletions in the Excel on the next sync', async () => {
    const tbId = db.createTermBase('Synced Glossary', 'en', 'fr');
    const filePath = writeWorkbook('terms.xlsx', [
      ['world', 'monde'],
      ['settings', 'parametres'],
    ]);
    await tbModule.setTBSyncConfig(tbId, {
      filePath,
      columns: { hasHeader: false, sourceCol: 0, targetCol: 1 },
    });

    await tbModule.syncTBEntriesFromExcel(tbId);
    expect(listTerms(tbId)).toHaveLength(2);

    await unlink(filePath);
    writeWorkbook('terms.xlsx', [['world', 'monde-v2']]);

    const result = await tbModule.syncTBEntriesFromExcel(tbId);
    expect(result).toEqual({ success: 1, skipped: 0, removed: 2 });
    expect(listTerms(tbId)).toEqual([{ srcTerm: 'world', tgtTerm: 'monde-v2', note: null }]);
  });

  it('leaves existing entries untouched and records failure when the file is unreadable', async () => {
    const tbId = db.createTermBase('Synced Glossary', 'en', 'fr');
    const filePath = writeWorkbook('terms.xlsx', [['world', 'monde']]);
    await tbModule.setTBSyncConfig(tbId, {
      filePath,
      columns: { hasHeader: false, sourceCol: 0, targetCol: 1 },
    });
    await tbModule.syncTBEntriesFromExcel(tbId);

    await unlink(filePath);

    await expect(tbModule.syncTBEntriesFromExcel(tbId)).rejects.toThrow();
    expect(listTerms(tbId)).toEqual([{ srcTerm: 'world', tgtTerm: 'monde', note: null }]);

    const config = tbModule.getTBSyncConfig(tbId);
    expect(config?.lastSyncStatus).toBe('failed');
    expect(config?.lastSyncError).toBeTruthy();
  });

  it('rolls the whole mirror back when a write fails mid-sync', async () => {
    const tbId = db.createTermBase('Synced Glossary', 'en', 'fr');
    const filePath = writeWorkbook('terms.xlsx', [
      ['world', 'monde'],
      ['poison', 'boom'],
      ['settings', 'parametres'],
    ]);

    const projectRepo = new SqliteProjectRepository(db);
    const settingsRepo = new SqliteSettingsRepository(db);
    const tx = new SqliteTransactionManager(db);
    const failingRepo = new Proxy(tbRepo, {
      get(target, prop, receiver) {
        if (prop === 'insertTBEntryIfAbsentBySrcTerm') {
          return (params: Parameters<SqliteTBRepository['insertTBEntryIfAbsentBySrcTerm']>[0]) => {
            if (params.srcTerm === 'poison') throw new Error('Forced insert failure');
            return target.insertTBEntryIfAbsentBySrcTerm(params);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const failingModule = new TBModule(
      failingRepo,
      tx,
      new TBService(projectRepo, tbRepo),
      vi.fn(),
      settingsRepo,
    );
    await failingModule.setTBSyncConfig(tbId, {
      filePath,
      columns: { hasHeader: false, sourceCol: 0, targetCol: 1 },
    });

    // Seed the TB so a failed mirror has something to preserve.
    db.insertTBEntryIfAbsentBySrcTerm({
      id: 'seed-1',
      tbId,
      srcLang: 'en',
      srcTerm: 'existing',
      tgtTerm: 'existant',
    });

    await expect(failingModule.syncTBEntriesFromExcel(tbId)).rejects.toThrow(
      'Forced insert failure',
    );

    // The clear and the partial writes must both have rolled back.
    expect(listTerms(tbId)).toEqual([{ srcTerm: 'existing', tgtTerm: 'existant', note: null }]);
    expect(failingModule.getTBSyncConfig(tbId)?.lastSyncStatus).toBe('failed');
  });

  it('rejects sync for a term base without a binding', async () => {
    const tbId = db.createTermBase('Plain', 'en', 'fr');
    await expect(tbModule.syncTBEntriesFromExcel(tbId)).rejects.toThrow(
      'not bound to a local Excel file',
    );
  });

  it('relink keeps sync history fields while replacing the file path', async () => {
    const tbId = db.createTermBase('Synced Glossary', 'en', 'fr');
    const filePath = writeWorkbook('terms.xlsx', [['world', 'monde']]);
    await tbModule.setTBSyncConfig(tbId, {
      filePath,
      columns: { hasHeader: false, sourceCol: 0, targetCol: 1 },
    });
    await tbModule.syncTBEntriesFromExcel(tbId);

    const movedPath = writeWorkbook('terms-moved.xlsx', [['world', 'monde']]);
    await tbModule.setTBSyncConfig(tbId, {
      filePath: movedPath,
      columns: { hasHeader: false, sourceCol: 0, targetCol: 1 },
    });

    const config = tbModule.getTBSyncConfig(tbId);
    expect(config?.filePath).toBe(movedPath);
    expect(config?.lastSyncStatus).toBe('success');
  });

  it('removes the sync config when the term base is deleted', async () => {
    const tbId = db.createTermBase('Synced Glossary', 'en', 'fr');
    await tbModule.setTBSyncConfig(tbId, {
      filePath: join(root, 'terms.xlsx'),
      columns: { hasHeader: true, sourceCol: 0, targetCol: 1 },
    });
    expect(tbModule.getTBSyncConfig(tbId)).not.toBeNull();

    await tbModule.deleteTB(tbId);
    expect(tbModule.getTBSyncConfig(tbId)).toBeNull();
  });
});
