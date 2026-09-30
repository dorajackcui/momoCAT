import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CATDatabase } from '../index';
import { CloudAccountTracker } from './CloudAccountTracker';

describe('account cloud dirty tracking', () => {
  let directory: string;
  let path: string;
  let db: CATDatabase;
  let tracker: CloudAccountTracker;
  let first: number;
  let second: number;
  let firstUUID: string;
  let secondUUID: string;
  let main: string;
  let tb: string;

  const withConnection = <T>(operation: (connection: Database.Database) => T): T => {
    const connection = new Database(path);
    try {
      connection.pragma('foreign_keys = ON');
      return operation(connection);
    } finally {
      connection.close();
    }
  };
  const acknowledgeAll = () => {
    for (const row of tracker.list()) tracker.acknowledge(row.kind, row.id, 1, 'baseline');
  };
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'momocat-cloud-tracker-'));
    path = join(directory, 'account.db');
    db = new CATDatabase(path);
    tracker = new CloudAccountTracker(path);
    first = db.createProject('First', 'en', 'zh');
    second = db.createProject('Second', 'en', 'zh');
    firstUUID = db.getProject(first)!.uuid;
    secondUUID = db.getProject(second)!.uuid;
    main = db.createTM('Shared', 'en', 'zh', 'main');
    tb = db.createTermBase('Shared terms', 'en', 'zh');
    for (const project of [first, second]) {
      db.mountTMToProject(project, main, 10, 'readwrite');
      db.mountTermBaseToProject(project, tb);
    }
    acknowledgeAll();
  });
  afterEach(() => {
    tracker.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('tracks independent resources once and keeps Working TM inside its project', () => {
    expect(
      tracker
        .list()
        .map(({ kind, id }) => `${kind}:${id}`)
        .sort(),
    ).toEqual([`project:${firstUUID}`, `project:${secondUUID}`, `tm:${main}`, `tb:${tb}`].sort());
    const working = db.getProjectMountedTMs(first).find((resource) => resource.type === 'working')!;
    const before = tracker.get('project', firstUUID)!;
    db.upsertTMEntry({
      id: 'working-entry',
      tmId: working.id,
      projectId: first,
      srcLang: 'en',
      tgtLang: 'zh',
      srcHash: 'working-hash',
      matchKey: 'crystal orchard',
      tagsSignature: '',
      sourceTokens: [{ type: 'text', content: 'Crystal orchard' }],
      targetTokens: [{ type: 'text', content: '水晶果园' }],
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      usageCount: 0,
    });
    expect(tracker.get('project', firstUUID)!.generation).toBeGreaterThan(before.generation);
    expect(tracker.get('project', secondUUID)!.generation).toBe(
      tracker.get('project', secondUUID)!.confirmed,
    );
    expect(tracker.get('tm', working.id)).toBeUndefined();
  });

  it('resource edits mark only that resource, even when two projects mount it', () => {
    const firstBefore = tracker.get('project', firstUUID);
    const secondBefore = tracker.get('project', secondUUID);
    db.renameTM(main, 'Renamed shared TM');
    db.upsertTBEntryBySrcTerm({
      id: 'shared-term',
      tbId: tb,
      srcLang: 'en',
      srcTerm: 'orchard',
      tgtTerm: '果园',
    });
    expect(tracker.get('tm', main)!.generation).toBeGreaterThan(tracker.get('tm', main)!.confirmed);
    expect(tracker.get('tb', tb)!.generation).toBeGreaterThan(tracker.get('tb', tb)!.confirmed);
    expect(tracker.get('project', firstUUID)).toEqual(firstBefore);
    expect(tracker.get('project', secondUUID)).toEqual(secondBefore);
  });

  it('rolls back dirty generations together with document and resource mutations', () => {
    const before = tracker.list();
    expect(() =>
      withConnection((connection) =>
        connection.transaction(() => {
          connection.prepare('UPDATE projects SET name = ? WHERE id = ?').run('Transient', first);
          connection.prepare('UPDATE tms SET name = ? WHERE id = ?').run('Transient', main);
          connection.prepare('UPDATE term_bases SET name = ? WHERE id = ?').run('Transient', tb);
          throw new Error('Synthetic rollback');
        })(),
      ),
    ).toThrow('rollback');
    expect(tracker.list()).toEqual(before);
    expect(db.getProject(first)!.name).toBe('First');
    expect(db.getTM(main)!.name).toBe('Shared');
    expect(db.getTermBase(tb)!.name).toBe('Shared terms');
  });

  it('detects independent worker-style connections and segment updates', () => {
    const file = db.createFile(first, 'source.xlsx');
    db.bulkInsertSegments([
      {
        segmentId: 'segment',
        fileId: file,
        orderIndex: 0,
        sourceTokens: [{ type: 'text', content: 'Orchard' }],
        targetTokens: [],
        status: 'empty',
        tagsSignature: '',
        matchKey: 'orchard',
        srcHash: 'orchard',
        meta: {},
      },
    ]);
    acknowledgeAll();
    const before = tracker.get('project', firstUUID)!;
    const worker = new CATDatabase(path);
    try {
      worker.updateSegmentTarget('segment', [{ type: 'text', content: '果园' }], 'draft');
      worker.renameTermBase(tb, 'Worker term update');
    } finally {
      worker.close();
    }
    expect(db.getSegment('segment')!.status).toBe('draft');
    expect(tracker.get('project', firstUUID)!.generation).toBeGreaterThan(before.generation);
    expect(tracker.get('tb', tb)!.generation).toBeGreaterThan(tracker.get('tb', tb)!.confirmed);
    expect(tracker.get('project', secondUUID)!.generation).toBe(
      tracker.get('project', secondUUID)!.confirmed,
    );
  });

  it('mount changes and file deletion mark the owning project only', () => {
    const file = db.createFile(first, 'remove.xlsx');
    acknowledgeAll();
    const untouched = tracker.get('project', secondUUID);
    const resource = tracker.get('tm', main);
    db.unmountTMFromProject(first, main);
    db.deleteFile(file);
    const row = tracker.get('project', firstUUID)!;
    expect(row.generation).toBeGreaterThan(row.confirmed);
    expect(tracker.get('project', secondUUID)).toEqual(untouched);
    expect(tracker.get('tm', main)).toEqual(resource);
  });

  it('ignores device settings and rebuildable FTS writes', () => {
    const before = tracker.list();
    db.setSetting('openai_api_key', 'synthetic-device-secret');
    db.setSetting('ui_theme', 'dark');
    db.setSetting(`tm_external_file_${main}`, '/synthetic/local/path.xlsx');
    withConnection((connection) =>
      connection
        .prepare('INSERT INTO tm_fts(tmId,srcText,tgtText,tmEntryId) VALUES(?,?,?,?)')
        .run(main, 'Synthetic', 'Synthetic', 'rebuildable-only'),
    );
    expect(tracker.list()).toEqual(before);
  });

  it('keeps the exact pending payload through reopen and acknowledges only its captured generation', () => {
    db.renameTM(main, 'First captured edit');
    const captured = tracker.get('tm', main)!;
    tracker.prepare('tm', main, '{"operationId":"original","payload":"first"}');
    tracker.prepare('tm', main, '{"operationId":"replacement","payload":"second"}');
    db.renameTM(main, 'Later edit');
    tracker.close();
    tracker = new CloudAccountTracker(path);
    expect(tracker.get('tm', main)!.pending).toBe('{"operationId":"original","payload":"first"}');
    tracker.acknowledge('tm', main, 2, 'captured-signature', captured.generation);
    const row = tracker.get('tm', main)!;
    expect(row).toMatchObject({
      revision: 2,
      signature: 'captured-signature',
      pending: null,
      confirmed: captured.generation,
    });
    expect(row.generation).toBeGreaterThan(row.confirmed);
    expect(row.lastSyncedAt).toBeTruthy();
  });
});
