import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CATDatabase } from '../index';

describe('TMRepo FTS replacement', () => {
  let db: CATDatabase;

  beforeEach(() => {
    db = new CATDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('replaces FTS rows in batch and keeps the last replacement for duplicate entry ids', () => {
    const projectId = db.createProject('Batch FTS Project', 'en', 'fr');
    const tmId = db.createTM('Main TM', 'en', 'fr', 'main');
    db.mountTMToProject(projectId, tmId, 10, 'read');
    const now = '2026-06-15T00:00:00.000Z';
    const entryId = db.upsertTMEntryBySrcHash({
      id: 'entry-hello',
      tmId,
      projectId: 0,
      srcLang: 'en',
      tgtLang: 'fr',
      srcHash: 'hash-hello',
      matchKey: 'hello',
      tagsSignature: '',
      sourceTokens: [{ type: 'text', content: 'Hello' }],
      targetTokens: [{ type: 'text', content: 'OldTarget' }],
      createdAt: now,
      updatedAt: now,
      usageCount: 1,
    });
    db.replaceTMFts(tmId, 'Hello', 'OldTarget', entryId);

    db.upsertTMEntryBySrcHash({
      id: 'entry-hello-new',
      tmId,
      projectId: 0,
      srcLang: 'en',
      tgtLang: 'fr',
      srcHash: 'hash-hello',
      matchKey: 'hello',
      tagsSignature: '',
      sourceTokens: [{ type: 'text', content: 'Hello' }],
      targetTokens: [{ type: 'text', content: 'ModernQuartz' }],
      createdAt: now,
      updatedAt: now,
      usageCount: 1,
    });
    (db as unknown as {
      replaceTMFtsBatch(rows: Array<{
        tmId: string;
        srcText: string;
        tgtText: string;
        tmEntryId: string;
      }>): void;
    }).replaceTMFtsBatch([
      { tmId, srcText: 'Hello', tgtText: 'AncientZebra', tmEntryId: entryId },
      { tmId, srcText: 'Hello', tgtText: 'ModernQuartz', tmEntryId: entryId },
    ]);

    expect(db.searchConcordance(projectId, 'AncientZebra', [tmId])).toHaveLength(0);
    const currentMatches = db.searchConcordance(projectId, 'ModernQuartz', [tmId]);
    expect(currentMatches).toHaveLength(1);
    expect(currentMatches[0].targetTokens).toEqual([
      { type: 'text', content: 'ModernQuartz' },
    ]);
  });

  it('keeps existing FTS rows when batch replacement insert fails', () => {
    const projectId = db.createProject('Atomic Batch FTS Project', 'en', 'fr');
    const tmId = db.createTM('Main TM', 'en', 'fr', 'main');
    db.mountTMToProject(projectId, tmId, 10, 'read');
    const now = '2026-06-15T00:00:00.000Z';
    const entryId = db.upsertTMEntryBySrcHash({
      id: 'entry-atomic',
      tmId,
      projectId: 0,
      srcLang: 'en',
      tgtLang: 'fr',
      srcHash: 'hash-atomic',
      matchKey: 'atomic',
      tagsSignature: '',
      sourceTokens: [{ type: 'text', content: 'Atomic' }],
      targetTokens: [{ type: 'text', content: 'OldNeedle' }],
      createdAt: now,
      updatedAt: now,
      usageCount: 1,
    });
    db.replaceTMFts(tmId, 'Atomic', 'OldNeedle', entryId);

    const repo = (db as unknown as {
      tmRepo: { stmtInsertTMFts: { run(...args: unknown[]): unknown } };
    }).tmRepo;
    const originalRun = repo.stmtInsertTMFts.run.bind(repo.stmtInsertTMFts);
    repo.stmtInsertTMFts.run = () => {
      throw new Error('forced insert failure');
    };

    try {
      expect(() =>
        db.replaceTMFtsBatch([
          { tmId, srcText: 'Atomic', tgtText: 'NewNeedle', tmEntryId: entryId },
        ]),
      ).toThrow('forced insert failure');
    } finally {
      repo.stmtInsertTMFts.run = originalRun;
    }

    expect(db.searchConcordance(projectId, 'OldNeedle', [tmId])).toHaveLength(1);
    expect(db.searchConcordance(projectId, 'NewNeedle', [tmId])).toHaveLength(0);
  });

  it('keeps exactly one FTS row per entry and tracks its rowid across rewrites', () => {
    const projectId = db.createProject('Rowid Project', 'en', 'fr');
    const tmId = db.createTM('Main TM', 'en', 'fr', 'main');
    db.mountTMToProject(projectId, tmId, 10, 'read');
    const now = '2026-06-15T00:00:00.000Z';
    const entry = {
      id: 'entry-rowid',
      tmId,
      projectId: 0,
      srcLang: 'en',
      tgtLang: 'fr',
      srcHash: 'hash-rowid',
      matchKey: 'rowid',
      tagsSignature: '',
      sourceTokens: [{ type: 'text', content: 'RowidSource' }],
      targetTokens: [{ type: 'text', content: 'FirstTarget' }],
      createdAt: now,
      updatedAt: now,
      usageCount: 1,
    };
    db.upsertTMEntry(entry);
    db.upsertTMEntry({ ...entry, targetTokens: [{ type: 'text', content: 'SecondTarget' }] });

    const raw = (db as unknown as {
      db: {
        prepare(sql: string): { get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] };
      };
    }).db;
    const ftsRows = raw
      .prepare('SELECT rowid AS ftsRowid, tgtText FROM tm_fts WHERE tmEntryId = ?')
      .all('entry-rowid') as Array<{ ftsRowid: number; tgtText: string }>;
    expect(ftsRows).toHaveLength(1);
    expect(ftsRows[0].tgtText).toBe('SecondTarget');

    const mapped = raw
      .prepare('SELECT ftsRowid FROM tm_entries WHERE id = ?')
      .get('entry-rowid') as { ftsRowid: number };
    expect(mapped.ftsRowid).toBe(ftsRows[0].ftsRowid);
  });

  it('falls back to a full-scan FTS delete when the stored rowid is stale', () => {
    const projectId = db.createProject('Stale Rowid Project', 'en', 'fr');
    const tmId = db.createTM('Main TM', 'en', 'fr', 'main');
    db.mountTMToProject(projectId, tmId, 10, 'read');
    const now = '2026-06-15T00:00:00.000Z';
    const entryId = db.upsertTMEntryBySrcHash({
      id: 'entry-stale',
      tmId,
      projectId: 0,
      srcLang: 'en',
      tgtLang: 'fr',
      srcHash: 'hash-stale',
      matchKey: 'stale',
      tagsSignature: '',
      sourceTokens: [{ type: 'text', content: 'StaleSource' }],
      targetTokens: [{ type: 'text', content: 'OldMeadow' }],
      createdAt: now,
      updatedAt: now,
      usageCount: 1,
    });
    db.insertTMFts(tmId, 'StaleSource', 'OldMeadow', entryId);

    const raw = (db as unknown as {
      db: { prepare(sql: string): { run(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] } };
    }).db;
    // Simulate a mapping corrupted by an app version that predates ftsRowid.
    raw.prepare('UPDATE tm_entries SET ftsRowid = 999999 WHERE id = ?').run(entryId);

    db.replaceTMFts(tmId, 'StaleSource', 'NewMeadow', entryId);

    const ftsRows = raw
      .prepare('SELECT tgtText FROM tm_fts WHERE tmEntryId = ?')
      .all(entryId) as Array<{ tgtText: string }>;
    expect(ftsRows).toHaveLength(1);
    expect(ftsRows[0].tgtText).toBe('NewMeadow');
    expect(db.searchConcordance(projectId, 'OldMeadow', [tmId])).toHaveLength(0);
    expect(db.searchConcordance(projectId, 'NewMeadow', [tmId])).toHaveLength(1);
  });

  it('deletes FTS rows when deleting a TM', () => {
    const tmId = db.createTM('Delete TM', 'en', 'fr', 'main');
    const now = '2026-06-15T00:00:00.000Z';
    const entryId = db.upsertTMEntryBySrcHash({
      id: 'entry-delete',
      tmId,
      projectId: 0,
      srcLang: 'en',
      tgtLang: 'fr',
      srcHash: 'hash-delete',
      matchKey: 'delete',
      tagsSignature: '',
      sourceTokens: [{ type: 'text', content: 'DeleteMe' }],
      targetTokens: [{ type: 'text', content: 'DeleteMoi' }],
      createdAt: now,
      updatedAt: now,
      usageCount: 1,
    });
    db.insertTMFts(tmId, 'DeleteMe', 'DeleteMoi', entryId);

    db.deleteTM(tmId);

    const row = (db as unknown as {
      db: { prepare(sql: string): { get(...args: unknown[]): unknown } };
    }).db
      .prepare('SELECT COUNT(*) AS count FROM tm_fts WHERE tmId = ?')
      .get(tmId) as { count: number };
    expect(row.count).toBe(0);
  });
});
