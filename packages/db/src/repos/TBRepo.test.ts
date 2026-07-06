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
