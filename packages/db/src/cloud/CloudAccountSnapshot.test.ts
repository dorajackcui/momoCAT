import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Segment, Token } from '@cat/core/models';
import { computeMatchKey, computeSrcHash } from '@cat/core/text';
import { CATDatabase } from '../index';
import {
  cloneCloudProjectAsLocal,
  cloneCloudProject,
  cloneLocalCloudResource,
  exportCloudAccountProject,
  exportCloudResource,
  restoreCloudAccountProject,
  restoreCloudResource,
  snapshotProjectUUID,
  type ProjectSnapshotV2,
} from './CloudAccountSnapshot';

const stamp = '2026-01-01T00:00:00.000Z';
const textTokens = (content: string): Token[] => [{ type: 'text', content }];

describe('account cloud snapshots', () => {
  let directory: string;
  let sourcePath: string;
  let targetPath: string;
  let source: CATDatabase;
  let target: CATDatabase;
  let projectId: number;
  let fileId: number;
  let mainId: string;
  let tbId: string;
  let segment: Segment;

  function raw<T>(path: string, fn: (db: Database.Database) => T): T {
    const db = new Database(path);
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }
  function addEntry(
    db: CATDatabase,
    tmId: string,
    id: string,
    src: string,
    tgt: string,
    origin?: string,
  ): void {
    const matchKey = computeMatchKey(textTokens(src));
    db.upsertTMEntry({
      id,
      tmId,
      projectId: 0,
      srcLang: 'en',
      tgtLang: 'zh',
      srcHash: computeSrcHash(matchKey, ''),
      matchKey,
      tagsSignature: '',
      sourceTokens: textTokens(src),
      targetTokens: textTokens(tgt),
      originSegmentId: origin,
      createdAt: stamp,
      updatedAt: stamp,
      usageCount: 2,
    });
  }
  function resourcesToTarget(): void {
    restoreCloudResource(targetPath, exportCloudResource(sourcePath, 'tm', mainId));
    restoreCloudResource(targetPath, exportCloudResource(sourcePath, 'tb', tbId));
  }
  function snapshot(): ProjectSnapshotV2 {
    return exportCloudAccountProject(sourcePath, projectId);
  }
  function rows(path: string, table: string): unknown[] {
    return raw(path, (db) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'momocat-account-cloud-'));
    sourcePath = join(directory, 'source.db');
    targetPath = join(directory, 'target.db');
    source = new CATDatabase(sourcePath);
    target = new CATDatabase(targetPath);
    projectId = source.createProject('Selected', 'en', 'zh');
    fileId = source.createFile(
      projectId,
      'source.xlsx',
      JSON.stringify({ sourceCol: 0, targetCol: 1 }),
    );
    segment = {
      segmentId: 'source-segment',
      fileId,
      orderIndex: 0,
      sourceTokens: [
        { type: 'tag', content: '<b>', meta: { id: '1', tagType: 'paired-start', pairedIndex: 2 } },
        ...textTokens('Crystal orchard'),
      ],
      targetTokens: [
        { type: 'tag', content: '<b>', meta: { id: '1', tagType: 'paired-start', pairedIndex: 2 } },
        ...textTokens('水晶果园'),
      ],
      status: 'confirmed',
      tagsSignature: 'tag-1',
      matchKey: 'crystal orchard',
      srcHash: 'source-segment-hash',
      meta: { rowRef: 2, updatedAt: stamp },
      qaIssues: [
        {
          ruleId: 'consistency',
          severity: 'warning',
          message: 'Synthetic',
          references: [{ segmentId: 'source-segment', row: 2 }],
        },
      ],
    };
    source.bulkInsertSegments([segment]);
    const working = source.getProjectMountedTMs(projectId).find((tm) => tm.type === 'working')!;
    addEntry(source, working.id, 'working-entry', 'Crystal orchard', '水晶果园', segment.segmentId);
    mainId = source.createTM('Shared main', 'en', 'zh', 'main');
    source.mountTMToProject(projectId, mainId, 7, 'readwrite');
    addEntry(source, mainId, 'main-entry', 'Crystal orchard', '水晶果园', 'old-local-origin');
    tbId = source.createTermBase('Shared terms', 'en', 'zh');
    source.mountTermBaseToProject(projectId, tbId, 9);
    source.insertTBEntryIfAbsentBySrcTerm({
      id: 'tb-entry',
      tbId,
      srcLang: 'en',
      srcTerm: 'Crystal orchard',
      tgtTerm: '水晶果园',
      note: 'Synthetic note',
      usageCount: 3,
    });
    source.createProjectSavedPrompt(projectId, 'Saved', 'Synthetic prompt');
    source.updateSegmentQaIssues(segment.segmentId, segment.qaIssues!);
    source.setSetting('private_api_key', 'never-transfer');
    source.setSetting(`tm_external_file_${mainId}`, '/private/device/path.xlsx');
    source.createProject('Unrelated source', 'ja', 'en');
    const targetOther = target.createProject('Unrelated target', 'ko', 'en');
    const targetFile = target.createFile(targetOther, 'keep.xlsx');
    target.bulkInsertSegments([
      { ...segment, segmentId: 'keep-segment', fileId: targetFile, qaIssues: undefined },
    ]);
    target.createProjectSavedPrompt(targetOther, 'Saved', 'Keep this prompt');
    target.setSetting('target_private_key', 'keep-this-setting');
  });
  afterEach(() => {
    source.close();
    target.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('transports stable identities without device IDs, FTS, unrelated data or settings', () => {
    const value = snapshot();
    expect(value.protocol).toBe(2);
    expect(value.sourceSQLite).toBe(15);
    expect(snapshotProjectUUID(value)).toBe(source.getProject(projectId)!.uuid);
    expect(value.files[0].uuid).toBe(source.listFiles(projectId)[0].uuid);
    expect(value.segments[0].fileUUID).toBe(value.files[0].uuid);
    expect(value.project).not.toHaveProperty('id');
    expect(value.files[0]).not.toHaveProperty('id');
    expect(value.prompts[0]).not.toHaveProperty('id');
    expect(value.workingTM!.entries[0]).not.toHaveProperty('ftsRowid');
    const serialized = JSON.stringify(value);
    for (const forbidden of [
      'never-transfer',
      '/private/device/path',
      'Unrelated source',
      'tm_fts',
      'app_settings',
      'tm_sync_staging',
    ])
      expect(serialized).not.toContain(forbidden);
    expect(serialized).not.toContain('main-entry');
    expect(serialized).not.toContain('tb-entry');
  });

  it('allocates device IDs and replaces only matching UUIDs atomically', () => {
    resourcesToTarget();
    const before = target.getSegment('keep-segment');
    const value = snapshot();
    const restored = restoreCloudAccountProject(targetPath, value);
    expect(restored).not.toBe(projectId);
    const targetFile = target.listFiles(restored)[0];
    expect(targetFile.id).not.toBe(fileId);
    expect(targetFile.uuid).toBe(value.files[0].uuid);
    expect(target.getSegment(segment.segmentId)?.fileId).toBe(targetFile.id);
    expect(target.getSegment(segment.segmentId)?.sourceTokens).toEqual(segment.sourceTokens);
    expect(target.getSegment(segment.segmentId)?.qaIssues).toEqual(segment.qaIssues);
    value.project.name = 'Downloaded replacement';
    value.segments[0].targetTokensJson = JSON.stringify(textTokens('新译文'));
    value.workingTM!.entries[0].targetTokensJson = JSON.stringify(textTokens('新译文'));
    const promptID = target.listProjectSavedPrompts(restored)[0].id;
    value.prompts[0].content = 'New prompt';
    expect(restoreCloudAccountProject(targetPath, value)).toBe(restored);
    expect(target.listFiles(restored)[0].id).toBe(targetFile.id);
    expect(target.listProjectSavedPrompts(restored)[0].id).toBe(promptID);
    expect(target.getSegment(segment.segmentId)?.targetTokens).toEqual(textTokens('新译文'));
    expect(target.listTMEntries(value.workingTM!.resource.id)[0].targetTokens).toEqual(
      textTokens('新译文'),
    );
    expect(target.getSegment('keep-segment')).toEqual(before);
    expect(target.getSetting('target_private_key')).toBe('keep-this-setting');
    expect(target.getSetting('private_api_key')).toBeUndefined();
  });

  it('requires shared resources and rejects file/segment collisions without losing existing data', () => {
    const value = snapshot();
    const before = rows(targetPath, 'projects');
    expect(() => restoreCloudAccountProject(targetPath, value)).toThrow('Main TM missing');
    expect(rows(targetPath, 'projects')).toEqual(before);
    resourcesToTarget();
    const conflictingFile = structuredClone(value);
    conflictingFile.files[0].uuid = target.listFiles(1)[0].uuid;
    conflictingFile.segments[0].fileUUID = conflictingFile.files[0].uuid;
    expect(() => restoreCloudAccountProject(targetPath, conflictingFile)).toThrow('file identity');
    const conflictingSegment = structuredClone(value);
    conflictingSegment.segments[0].segmentId = 'keep-segment';
    expect(() => restoreCloudAccountProject(targetPath, conflictingSegment)).toThrow(
      'segment identity',
    );
    expect(rows(targetPath, 'projects')).toEqual(before);
    expect(target.getSegment('keep-segment')).toBeDefined();
  });

  it('preserves a shared Main TM and TB while multiple projects are replaced', () => {
    resourcesToTarget();
    const first = restoreCloudAccountProject(targetPath, snapshot());
    const other = source.createProject('Second shared project', 'en', 'zh');
    source.mountTMToProject(other, mainId, 11, 'read');
    source.mountTermBaseToProject(other, tbId, 12);
    const second = restoreCloudAccountProject(
      targetPath,
      exportCloudAccountProject(sourcePath, other),
    );
    const updatedTM = exportCloudResource(sourcePath, 'tm', mainId);
    if (updatedTM.kind !== 'tm') throw new Error('Expected TM');
    updatedTM.entries[0].targetTokensJson = JSON.stringify(textTokens('共享新译文'));
    restoreCloudResource(targetPath, updatedTM);
    const updatedTB = exportCloudResource(sourcePath, 'tb', tbId);
    if (updatedTB.kind !== 'tb') throw new Error('Expected TB');
    updatedTB.entries[0].tgtTerm = '共享术语';
    restoreCloudResource(targetPath, updatedTB);
    restoreCloudAccountProject(targetPath, snapshot());
    expect(target.listTMEntries(mainId)[0].targetTokens).toEqual(textTokens('共享新译文'));
    expect(target.listProjectTermEntries(first)[0].tgtTerm).toBe('共享术语');
    expect(target.listProjectTermEntries(second)[0].tgtTerm).toBe('共享术语');
    expect(target.getProjectMountedTMs(first).find((tm) => tm.id === mainId)?.priority).toBe(7);
    expect(target.getProjectMountedTMs(second).find((tm) => tm.id === mainId)?.permission).toBe(
      'read',
    );
    expect(target.listTMs().filter((tm) => tm.id === mainId)).toHaveLength(1);
  });

  it.each(['en', 'zh', 'ja', 'ko'])(
    'rebuilds TM/TB FTS using local writer semantics for %s',
    (srcLang) => {
      const text =
        srcLang === 'en'
          ? 'Crystal orchard setting'
          : srcLang === 'zh'
            ? '水晶果园设置'
            : srcLang === 'ja'
              ? '水晶果園設定'
              : '수정 과수원 설정';
      const project = source.createProject(`Profile ${srcLang}`, srcLang, 'en');
      const tm = source.createTM('Profile TM', srcLang, 'en', 'main');
      source.mountTMToProject(project, tm, 4, 'read');
      const tb = source.createTermBase('Profile TB', srcLang, 'en');
      source.mountTermBaseToProject(project, tb);
      addEntry(source, tm, `profile-tm-${srcLang}`, text, 'Target');
      source.insertTBEntryIfAbsentBySrcTerm({
        id: `profile-tb-${srcLang}`,
        tbId: tb,
        srcLang,
        srcTerm: text,
        tgtTerm: 'Target',
      });
      const tmValue = exportCloudResource(sourcePath, 'tm', tm);
      const tbValue = exportCloudResource(sourcePath, 'tb', tb);
      restoreCloudResource(targetPath, tmValue);
      restoreCloudResource(targetPath, tbValue);
      const copied = restoreCloudAccountProject(
        targetPath,
        exportCloudAccountProject(sourcePath, project),
      );
      expect(target.searchTMRecallCandidates(copied, text).map((entry) => entry.id)).toEqual(
        source.searchTMRecallCandidates(project, text).map((entry) => entry.id),
      );
      expect(
        target.searchProjectTermEntries(copied, text, { srcLang }).map((entry) => entry.id),
      ).toEqual(
        source.searchProjectTermEntries(project, text, { srcLang }).map((entry) => entry.id),
      );
      raw(targetPath, (db) => {
        expect(
          db
            .prepare(
              'SELECT 1 FROM tm_entries e JOIN tm_fts f ON f.rowid = e.ftsRowid AND f.tmEntryId = e.id WHERE e.tmId = ?',
            )
            .get(tm),
        ).toBeDefined();
        expect(
          db
            .prepare(
              'SELECT 1 FROM tb_entries e JOIN tb_fts f ON f.rowid = e.ftsRowid AND f.tbEntryId = e.id WHERE e.tbId = ?',
            )
            .get(tb),
        ).toBeDefined();
        expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      });
    },
  );

  it('rejects foreign resource entry IDs before replacing existing entries or mounts', () => {
    resourcesToTarget();
    const foreign = target.createTM('Private other TM', 'en', 'zh', 'main');
    addEntry(target, foreign, 'foreign-entry', 'Keep', '保留');
    const copied = restoreCloudAccountProject(targetPath, snapshot());
    const before = rows(targetPath, 'tm_entries');
    const value = exportCloudResource(sourcePath, 'tm', mainId);
    value.entries[0].id = 'foreign-entry';
    expect(() => restoreCloudResource(targetPath, value)).toThrow('another resource');
    expect(rows(targetPath, 'tm_entries')).toEqual(before);
    expect(target.getProjectMountedTMs(copied).find((tm) => tm.id === mainId)).toBeDefined();
  });

  it('invalidates QA on all projects mounting a restored TB and keeps unrelated QA', () => {
    resourcesToTarget();
    const first = restoreCloudAccountProject(targetPath, snapshot());
    const second = target.createProject('Second QA project', 'en', 'zh');
    const secondFile = target.createFile(second, 'second.xlsx');
    target.bulkInsertSegments([{ ...segment, segmentId: 'second-qa-segment', fileId: secondFile }]);
    target.mountTermBaseToProject(second, tbId);
    target.updateSegmentQaIssues(segment.segmentId, segment.qaIssues!);
    target.updateSegmentQaIssues('second-qa-segment', segment.qaIssues!);
    target.updateSegmentQaIssues('keep-segment', segment.qaIssues!);
    expect(target.listFiles(first)).toHaveLength(1);
    restoreCloudResource(targetPath, exportCloudResource(sourcePath, 'tb', tbId));
    expect(target.getSegment(segment.segmentId)?.qaIssues).toBeUndefined();
    expect(target.getSegment('second-qa-segment')?.qaIssues).toBeUndefined();
    expect(target.getSegment('keep-segment')?.qaIssues).toEqual(segment.qaIssues);
  });

  it('rejects malformed transport and token metadata before restoring anything', () => {
    resourcesToTarget();
    const cases: ((value: ProjectSnapshotV2) => void)[] = [
      (value) => {
        (value.project as unknown as Record<string, unknown>).id = 1;
      },
      (value) => {
        value.files[0].name = '../escape.xlsx';
      },
      (value) => {
        value.files[0].uuid = '../outside';
      },
      (value) => {
        value.segments[0].fileUUID = 'missing-file';
      },
      (value) => {
        value.segments[0].sourceTokensJson = '{"type":"text"}';
      },
      (value) => {
        value.segments[0].sourceTokensJson =
          '[{"type":"tag","content":"x","meta":{"pairedIndex":-1}}]';
      },
      (value) => {
        value.mounts.tms[0].priority = Number.NaN;
      },
      (value) => {
        value.workingTM!.entries[0].tmId = mainId;
      },
      (value) => {
        value.files.push(value.files[0]);
      },
    ];
    const before = rows(targetPath, 'projects');
    for (const change of cases) {
      const value = snapshot();
      change(value);
      expect(() => restoreCloudAccountProject(targetPath, value)).toThrow();
      expect(rows(targetPath, 'projects')).toEqual(before);
    }
  });

  it('keeps source hash and normalized term keys authoritative, including long source text', () => {
    addEntry(source, mainId, 'long-entry', 'Long source '.repeat(100), 'Target');
    const value = exportCloudResource(sourcePath, 'tm', mainId);
    restoreCloudResource(targetPath, value);
    expect(target.listTMEntries(mainId).map((entry) => entry.srcHash)).toEqual(
      source.listTMEntries(mainId).map((entry) => entry.srcHash),
    );
    const tb = exportCloudResource(sourcePath, 'tb', tbId);
    if (tb.kind !== 'tb') throw new Error('Expected TB');
    tb.entries[0].srcNorm = 'legacy authoritative norm';
    restoreCloudResource(targetPath, tb);
    expect(
      raw(targetPath, (db) => db.prepare('SELECT srcText FROM tb_fts WHERE tbId = ?').get(tbId)),
    ).toEqual({ srcText: 'legacy authoritative norm' });
  });

  it('copies a local resource with independent identities and no local segment origins', () => {
    resourcesToTarget();
    const clone = cloneLocalCloudResource(sourcePath, targetPath, 'tm', mainId);
    expect(clone).not.toBe(mainId);
    expect(target.listTMEntries(clone)[0].id).not.toBe('main-entry');
    expect(target.listTMEntries(clone)[0].originSegmentId).toBeNull();
    expect(target.listTMEntries(clone)[0].srcHash).toBe(source.listTMEntries(mainId)[0].srcHash);
    expect(target.listTMEntries(mainId)[0].id).toBe('main-entry');
    const termClone = cloneLocalCloudResource(sourcePath, targetPath, 'tb', tbId);
    expect(termClone).not.toBe(tbId);
    expect(target.listTBEntries(termClone)[0].id).not.toBe('tb-entry');
    expect(target.listTBEntries(termClone)[0].srcNorm).toBe(source.listTBEntries(tbId)[0].srcNorm);
    expect(target.getSetting('private_api_key')).toBeUndefined();
  });

  it('creates an independent local conflict copy with mapped Working TM and QA origins', () => {
    resourcesToTarget();
    const existing = restoreCloudAccountProject(targetPath, snapshot());
    const before = snapshotProjectUUID(exportCloudAccountProject(targetPath, existing));
    const copy = cloneCloudProjectAsLocal(sourcePath, targetPath, projectId);
    const value = exportCloudAccountProject(targetPath, copy);
    expect(value.project.uuid).not.toBe(before);
    expect(value.project.name).toBe('Selected (local copy)');
    expect(value.files[0].uuid).not.toBe(snapshot().files[0].uuid);
    expect(value.segments[0].segmentId).not.toBe(segment.segmentId);
    expect(value.workingTM!.entries[0].originSegmentId).toBe(value.segments[0].segmentId);
    expect(JSON.parse(value.segments[0].qaIssuesJson!)[0].references[0].segmentId).toBe(
      value.segments[0].segmentId,
    );
    expect(
      value.mounts.tms.find((mount) => mount.tmId !== value.workingTM!.resource.id)?.priority,
    ).toBe(7);
    expect(
      value.mounts.tms.every(
        (mount) => !snapshot().mounts.tms.some((old) => old.tmId === mount.tmId),
      ),
    ).toBe(true);
    expect(value.mounts.tbs[0].tbId).not.toBe(tbId);
    expect(target.getSegment('keep-segment')).toBeDefined();
    expect(target.getProject(existing)?.uuid).toBe(before);
    expect(target.getSetting('target_private_key')).toBe('keep-this-setting');
  });

  it('converts a legacy project using its remote UUID without reusing file or resource identities', () => {
    resourcesToTarget();
    restoreCloudAccountProject(targetPath, snapshot());
    const original = snapshot();
    const remoteUUID = 'legacy-cloud-remote-project';
    const restored = cloneCloudProject(
      sourcePath,
      targetPath,
      projectId,
      { uuid: remoteUUID },
      (id, files) => {
        expect(id).toBeGreaterThan(projectId);
        expect(files.map((file) => file.name)).toEqual(original.files.map((file) => file.name));
        expect(files[0].uuid).not.toBe(original.files[0].uuid);
      },
    );
    const converted = exportCloudAccountProject(targetPath, restored);
    expect(converted.project.uuid).toBe(remoteUUID);
    expect(converted.project.name).toBe(original.project.name);
    expect(converted.segments[0].segmentId).not.toBe(original.segments[0].segmentId);
    expect(converted.workingTM!.resource.id).not.toBe(original.workingTM!.resource.id);
    expect(converted.workingTM!.entries[0].id).not.toBe(original.workingTM!.entries[0].id);
    expect(converted.workingTM!.entries[0].originSegmentId).toBe(converted.segments[0].segmentId);
    expect(
      converted.mounts.tms.every(
        (mount) => !original.mounts.tms.some((old) => old.tmId === mount.tmId),
      ),
    ).toBe(true);
    expect(converted.mounts.tbs[0].tbId).not.toBe(original.mounts.tbs[0].tbId);
    const before = rows(targetPath, 'tm_entries');
    expect(() =>
      cloneCloudProject(sourcePath, targetPath, projectId, { uuid: remoteUUID }),
    ).toThrow('already exists');
    expect(rows(targetPath, 'tm_entries')).toEqual(before);
    expect(snapshot()).toEqual(original);
  });

  it('maps cloned file identities explicitly when source list order differs from insertion order', () => {
    const secondFile = source.createFile(projectId, 'newer.xlsx');
    raw(sourcePath, (db) => {
      db.prepare('UPDATE files SET createdAt = ? WHERE id = ?').run('2025-01-01', fileId);
      db.prepare('UPDATE files SET createdAt = ? WHERE id = ?').run('2027-01-01', secondFile);
    });
    const sourceFiles = source.listFiles(projectId);
    expect(sourceFiles.map((file) => file.name)).toEqual(['newer.xlsx', 'source.xlsx']);
    const sourceByUUID = new Map(sourceFiles.map((file) => [file.uuid, file]));
    const restored = cloneCloudProject(sourcePath, targetPath, projectId, {}, (_id, files) => {
      expect(files.map((file) => file.name)).toEqual(['source.xlsx', 'newer.xlsx']);
      for (const file of files) {
        expect(file.sourceUUID).toBeDefined();
        expect(sourceByUUID.get(file.sourceUUID!)?.name).toBe(file.name);
        expect(file.uuid).not.toBe(file.sourceUUID);
      }
    });
    expect(target.listFiles(restored).map((file) => file.name)).toEqual([
      'newer.xlsx',
      'source.xlsx',
    ]);
  });

  it('rejects ownership of another project Working TM without modifying either project', () => {
    resourcesToTarget();
    const first = restoreCloudAccountProject(targetPath, snapshot());
    const value = snapshot();
    value.project.uuid = 'other-project-uuid';
    value.files = [];
    value.segments = [];
    expect(() => restoreCloudAccountProject(targetPath, value)).toThrow('another project');
    expect(target.getProject(first)?.name).toBe('Selected');
    expect(target.listProjects()).toHaveLength(2);
  });

  it('rolls back project, files, Working TM and FTS when the file installation callback fails', () => {
    resourcesToTarget();
    const id = restoreCloudAccountProject(targetPath, snapshot());
    const tables = [
      'projects',
      'files',
      'segments',
      'project_prompts',
      'tm_entries',
      'tm_fts',
      'project_tms',
    ];
    const before = tables.map((table) => rows(targetPath, table));
    const value = snapshot();
    value.project.name = 'Should roll back';
    value.workingTM!.entries[0].targetTokensJson = JSON.stringify(textTokens('Should roll back'));
    expect(() =>
      restoreCloudAccountProject(targetPath, value, (project, files) => {
        expect(project).toBe(id);
        expect(files).toEqual([
          {
            id: target.listFiles(id)[0].id,
            uuid: value.files[0].uuid,
            name: value.files[0].name,
            projectId: id,
          },
        ]);
        throw new Error('Synthetic file installation failure');
      }),
    ).toThrow('file installation failure');
    for (let index = 0; index < tables.length; index++)
      expect(rows(targetPath, tables[index])).toEqual(before[index]);
  });

  it('rolls back all copied resources if a conflict copy file installation fails', () => {
    const tables = [
      'projects',
      'files',
      'segments',
      'tms',
      'tm_entries',
      'tm_fts',
      'term_bases',
      'tb_entries',
      'tb_fts',
    ];
    const before = tables.map((table) => rows(targetPath, table));
    expect(() =>
      cloneCloudProjectAsLocal(sourcePath, targetPath, projectId, () => {
        throw new Error('Synthetic local copy failure');
      }),
    ).toThrow('local copy failure');
    for (let index = 0; index < tables.length; index++)
      expect(rows(targetPath, tables[index])).toEqual(before[index]);
  });
});
