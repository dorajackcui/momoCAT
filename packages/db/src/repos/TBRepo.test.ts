import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CATDatabase } from '../index';

interface RawDb {
  db: {
    prepare(sql: string): {
      get(...args: unknown[]): unknown;
      all(...args: unknown[]): unknown[];
      run(...args: unknown[]): unknown;
    };
  };
}

describe('TBRepo FTS replacement', () => {
  let db: CATDatabase;
  let tbId: string;

  beforeEach(() => {
    db = new CATDatabase(':memory:');
    tbId = db.createTermBase('Main TB', 'en', 'fr');
  });

  afterEach(() => {
    db.close();
  });

  function raw() {
    return (db as unknown as RawDb).db;
  }

  it('renames a term base without changing its contents, mounts, recency, or ordering', () => {
    const projectId = db.createProject('Rename Project', 'en', 'fr');
    const newerTbId = db.createTermBase('Newer TB', 'en', 'fr');
    db.mountTermBaseToProject(projectId, tbId, 5);
    db.mountTermBaseToProject(projectId, newerTbId, 5);
    db.insertTBEntryIfAbsentBySrcTerm({
      id: 'rename-entry',
      tbId,
      srcLang: 'en',
      srcTerm: 'Hello',
      tgtTerm: 'Bonjour',
    });
    const stableUpdatedAt = '2020-01-01T00:00:00.000Z';
    raw().prepare('UPDATE term_bases SET updatedAt = ? WHERE id = ?').run(stableUpdatedAt, tbId);
    raw()
      .prepare('UPDATE term_bases SET updatedAt = ? WHERE id = ?')
      .run('2021-01-01T00:00:00.000Z', newerTbId);
    const mountedBefore = db.getProjectMountedTermBases(projectId).map((tb) => tb.id);
    const version = db.getTBDataVersion();

    db.renameTermBase(tbId, '  Renamed TB  ');

    expect(db.getTermBase(tbId)).toMatchObject({
      id: tbId,
      name: 'Renamed TB',
      updatedAt: stableUpdatedAt,
    });
    expect(db.getTermBaseStats(tbId).entryCount).toBe(1);
    expect(db.getProjectMountedTermBases(projectId).map((tb) => tb.id)).toEqual(mountedBefore);
    expect(db.getTBDataVersion()).toBeGreaterThan(version);
  });

  it('rejects empty names and nonexistent term bases without invalidating metadata', () => {
    const version = db.getTBDataVersion();

    expect(() => db.renameTermBase(tbId, '   ')).toThrow('Term base name cannot be empty.');
    expect(() => db.renameTermBase('missing-tb', 'Renamed TB')).toThrow('Term base not found.');
    expect(db.getTermBase(tbId)?.name).toBe('Main TB');
    expect(db.getTBDataVersion()).toBe(version);
  });

  it('keeps exactly one FTS row per entry and tracks its rowid across rewrites', () => {
    const entryId = db.upsertTBEntryBySrcTerm({
      id: 'entry-rowid',
      tbId,
      srcLang: 'en',
      srcTerm: 'Quartz Lantern',
      tgtTerm: 'Lanterne de quartz',
    });
    // Same srcNorm again: merges into the existing entry and rewrites its FTS row.
    db.upsertTBEntryBySrcTerm({
      id: 'entry-rowid-2',
      tbId,
      srcLang: 'en',
      srcTerm: 'Quartz Lantern',
      tgtTerm: 'Lanterne moderne',
    });

    const ftsRows = raw()
      .prepare('SELECT rowid AS ftsRowid FROM tb_fts WHERE tbEntryId = ?')
      .all(entryId) as Array<{ ftsRowid: number }>;
    expect(ftsRows).toHaveLength(1);

    const mapped = raw()
      .prepare('SELECT ftsRowid FROM tb_entries WHERE id = ?')
      .get(entryId) as { ftsRowid: number };
    expect(mapped.ftsRowid).toBe(ftsRows[0].ftsRowid);

    const entry = raw()
      .prepare('SELECT tgtTerm FROM tb_entries WHERE id = ?')
      .get(entryId) as { tgtTerm: string };
    expect(entry.tgtTerm).toBe('Lanterne moderne');
  });

  it('falls back to a full-scan FTS delete when the stored rowid is stale', () => {
    const entryId = db.upsertTBEntryBySrcTerm({
      id: 'entry-stale',
      tbId,
      srcLang: 'en',
      srcTerm: 'Stale Meadow',
      tgtTerm: 'Vieille prairie',
    });
    // Simulate a mapping corrupted by an app version that predates ftsRowid.
    raw().prepare('UPDATE tb_entries SET ftsRowid = 999999 WHERE id = ?').run(entryId);

    db.upsertTBEntryBySrcTerm({
      id: 'entry-stale-2',
      tbId,
      srcLang: 'en',
      srcTerm: 'Stale Meadow',
      tgtTerm: 'Prairie fraiche',
    });

    const ftsRows = raw()
      .prepare('SELECT rowid AS ftsRowid FROM tb_fts WHERE tbEntryId = ?')
      .all(entryId) as Array<{ ftsRowid: number }>;
    expect(ftsRows).toHaveLength(1);

    const mapped = raw()
      .prepare('SELECT ftsRowid FROM tb_entries WHERE id = ?')
      .get(entryId) as { ftsRowid: number };
    expect(mapped.ftsRowid).toBe(ftsRows[0].ftsRowid);
  });

  it('insertTBEntryIfAbsentBySrcTerm records the FTS rowid for fresh inserts', () => {
    const entryId = db.insertTBEntryIfAbsentBySrcTerm({
      id: 'entry-fresh',
      tbId,
      srcLang: 'en',
      srcTerm: 'Fresh Harbor',
      tgtTerm: 'Port frais',
    });
    expect(entryId).toBe('entry-fresh');

    // A duplicate insert is a no-op and must not disturb the FTS row.
    const duplicate = db.insertTBEntryIfAbsentBySrcTerm({
      id: 'entry-fresh-2',
      tbId,
      srcLang: 'en',
      srcTerm: 'Fresh Harbor',
      tgtTerm: 'Autre port',
    });
    expect(duplicate).toBeUndefined();

    const ftsRows = raw()
      .prepare('SELECT rowid AS ftsRowid FROM tb_fts WHERE tbEntryId = ?')
      .all('entry-fresh') as Array<{ ftsRowid: number }>;
    expect(ftsRows).toHaveLength(1);

    const mapped = raw()
      .prepare('SELECT ftsRowid FROM tb_entries WHERE id = ?')
      .get('entry-fresh') as { ftsRowid: number };
    expect(mapped.ftsRowid).toBe(ftsRows[0].ftsRowid);
  });
});
