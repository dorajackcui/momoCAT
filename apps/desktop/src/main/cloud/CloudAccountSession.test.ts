import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_BLOB_BYTES,
  parseProjectManifestV2,
  parseResourceManifestV2,
  type CloudProjectV2,
  type CloudResourceV2,
} from '@cat/cloud-contracts';
import type { ProjectSnapshotV2 } from '@cat/db';
import { CloudAccountSession } from './CloudAccountSession';
import { CloudConnection, CloudRequestError, cloudChunkHashes } from './CloudConnection';

// Keep the actual connection error class and hashing; no Electron process is needed.
vi.mock('electron', () => ({ safeStorage: {}, shell: {} }));

describe('manual account cloud relay', () => {
  const directories: string[] = [];
  const sessions = new Set<CloudAccountSession>();
  const close = (session: CloudAccountSession) => {
    session.dispose();
    sessions.delete(session);
  };
  afterEach(() => {
    vi.useRealTimers();
    for (const session of sessions) session.dispose();
    sessions.clear();
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'momocat-account-session-'));
    directories.push(directory);
    const projects = new Map<string, CloudProjectV2>();
    const resources = new Map<string, CloudResourceV2>();
    const blobs = new Map<string, Buffer>();
    const operations = new Map<string, { payload: string; revision: number }>();
    let lostReply: string | undefined;
    let failedCommit: string | undefined;
    let failedDownload: string | undefined;
    let advanceBeforeCommit: string | undefined;
    const upload = vi.fn(async (data: Uint8Array) => {
      const hashes = cloudChunkHashes(data);
      hashes.forEach((hash, index) =>
        blobs.set(
          hash,
          Buffer.from(data.subarray(index * MAX_BLOB_BYTES, (index + 1) * MAX_BLOB_BYTES)),
        ),
      );
      return hashes;
    });
    const download = vi.fn(async (hashes: string[]) => {
      if (failedDownload && hashes.includes(failedDownload)) {
        failedDownload = undefined;
        throw new Error('Download interrupted');
      }
      return Buffer.concat(
        hashes.map((hash) => {
          const bytes = blobs.get(hash);
          if (!bytes) throw new CloudRequestError(404, 'Blob not found');
          return bytes;
        }),
      );
    });
    // Test-only authenticated account service. CATDatabase, tracker, filesystem
    // transfer, serialization and session orchestration remain their real code.
    const json = vi.fn(
      async (route: string, method = 'GET', body?: Record<string, unknown>): Promise<unknown> => {
        const parts = route.split('/').filter(Boolean);
        const isProject = parts[1] === 'projects';
        const catalog = isProject ? projects : resources;
        const id = parts[2];
        if (method === 'GET') {
          if (!id) return structuredClone([...catalog.values()]);
          const row = catalog.get(id);
          if (!row) throw new CloudRequestError(404, 'Object not found');
          return structuredClone(row);
        }
        if (method !== 'POST' || !body) throw new Error('Unexpected test request');
        const manifest = isProject
          ? parseProjectManifestV2(body.manifest)
          : parseResourceManifestV2(body.manifest);
        if ('resources' in manifest) {
          for (const ref of manifest.resources)
            if (resources.get(ref.id)?.kind !== ref.kind)
              throw new CloudRequestError(400, 'Resource not found');
        }
        if (!id) {
          const createdId = String(body.id);
          const existing = catalog.get(createdId);
          if (existing) {
            if (
              existing.name !== body.name ||
              JSON.stringify(existing.manifest) !== JSON.stringify(manifest)
            )
              throw new CloudRequestError(409, 'ID already exists');
            return structuredClone(existing);
          }
          if ('state' in manifest) {
            const project: CloudProjectV2 = {
              id: createdId,
              name: String(body.name),
              revision: 1,
              updatedAt: 1,
              manifest,
            };
            projects.set(createdId, project);
            return structuredClone(project);
          }
          const resource: CloudResourceV2 = {
            id: createdId,
            kind: manifest.kind,
            name: String(body.name),
            srcLang: String(body.srcLang),
            tgtLang: String(body.tgtLang),
            revision: 1,
            updatedAt: 1,
            manifest,
          };
          resources.set(createdId, resource);
          return structuredClone(resource);
        }
        if (failedCommit === id) {
          failedCommit = undefined;
          throw new Error('Commit interrupted');
        }
        const row = catalog.get(id);
        if (!row) throw new CloudRequestError(404, 'Object not found');
        if (advanceBeforeCommit === id) {
          advanceBeforeCommit = undefined;
          row.revision++;
        }
        const operation = `${parts[1]}:${id}:${String(body.operationId)}`;
        const payload = JSON.stringify(body);
        const previous = operations.get(operation);
        if (previous) {
          if (previous.payload !== payload) throw new CloudRequestError(409, 'Operation reused');
          return { revision: previous.revision };
        }
        if (body.revision !== row.revision) throw new CloudRequestError(409, 'Newer cloud version');
        row.revision++;
        row.updatedAt++;
        row.name = body.name === undefined ? row.name : String(body.name);
        // The catalogs have separately validated manifest types above.
        if (isProject) projects.set(id, { ...row, manifest } as CloudProjectV2);
        else resources.set(id, { ...row, manifest } as CloudResourceV2);
        operations.set(operation, { payload, revision: row.revision });
        if (lostReply === id) {
          lostReply = undefined;
          throw new Error('Response interrupted');
        }
        return { revision: row.revision };
      },
    );
    const connection = {
      json,
      upload,
      download,
      account: { id: 'alice', email: 'alice@example.test', name: 'Alice' },
    } as unknown as CloudConnection;
    const session = async (device: string) => {
      const result = new CloudAccountSession(join(directory, device), connection);
      await result.initialize();
      sessions.add(result);
      return result;
    };
    const commits = (id: string) =>
      json.mock.calls
        .filter(([route, method]) => method === 'POST' && route.endsWith(`/${id}/commit`))
        .map(([, , body]) => body!);
    return {
      session,
      projects,
      resources,
      blobs,
      operations,
      upload,
      download,
      json,
      commits,
      loseReply: (id: string) => {
        lostReply = id;
      },
      failCommit: (id: string) => {
        failedCommit = id;
      },
      failDownload: (hash: string) => {
        failedDownload = hash;
      },
      advanceBeforeCommit: (id: string) => {
        advanceBeforeCommit = id;
      },
    };
  }

  async function seeded() {
    const cloud = fixture();
    const a = await cloud.session('a');
    const first = a.db.createProject('First', 'en', 'zh');
    const second = a.db.createProject('Second', 'en', 'zh');
    const firstUUID = a.db.getProject(first)!.uuid;
    const secondUUID = a.db.getProject(second)!.uuid;
    const tm = a.db.createTM('Shared TM', 'en', 'zh', 'main');
    const tb = a.db.createTermBase('Shared TB', 'en', 'zh');
    a.db.upsertTBEntryBySrcTerm({
      id: 'orchard-term',
      tbId: tb,
      srcLang: 'en',
      srcTerm: 'orchard',
      tgtTerm: '果园',
    });
    for (const project of [first, second]) {
      a.db.mountTMToProject(project, tm, 3, 'readwrite');
      a.db.mountTermBaseToProject(project, tb, 4);
    }
    const file = a.db.createFile(first, 'source.xlsx');
    mkdirSync(join(a.projectsDir, String(first)), { recursive: true });
    const original = join(a.projectsDir, String(first), `${file}_source.xlsx`);
    writeFileSync(original, 'original file fixture');
    a.db.bulkInsertSegments([
      {
        segmentId: 'orchard-segment',
        fileId: file,
        orderIndex: 0,
        sourceTokens: [{ type: 'text', content: 'Crystal orchard' }],
        targetTokens: [],
        status: 'empty',
        tagsSignature: '',
        matchKey: 'crystal orchard',
        srcHash: 'fixture-source',
        meta: {},
      },
    ]);
    await a.synchronize(first);
    await a.synchronize(second);
    return { ...cloud, a, first, second, firstUUID, secondUUID, tm, tb, file, original };
  }

  it('saves locally without timers or implicit reopening uploads', async () => {
    const f = await seeded();
    f.json.mockClear();
    f.upload.mockClear();
    vi.useFakeTimers();
    f.a.db.updateProjectAISettings(f.first, 'Local draft', '');
    await vi.advanceTimersByTimeAsync(65_000);
    expect(f.json).not.toHaveBeenCalled();
    expect(f.upload).not.toHaveBeenCalled();
    expect(f.a.status(f.first)).toMatchObject({ pending: true, syncing: false });
    vi.useRealTimers();
    close(f.a);
    const reopened = await f.session('a');
    expect(await reopened.openProject(f.firstUUID)).toBe(f.first);
    expect(reopened.db.getProject(f.first)!.aiPrompt).toBe('Local draft');
    expect(f.json).not.toHaveBeenCalled();
    await reopened.synchronize(f.first);
    expect(reopened.status(f.first)).toMatchObject({
      pending: false,
      syncing: false,
      project: { revision: 2, writable: true },
    });
  });

  it('downloads two projects with exactly one local copy of their shared TM/TB', async () => {
    const f = await seeded();
    const b = await f.session('b');
    const first = await b.openProject(f.firstUUID);
    const second = await b.openProject(f.secondUUID);
    expect(b.db.listTMs('main').map((resource) => resource.id)).toEqual([f.tm]);
    expect(b.db.listTermBases().map((resource) => resource.id)).toEqual([f.tb]);
    for (const id of [first, second]) {
      expect(b.db.getProjectMountedTMs(id).find((resource) => resource.type === 'main')?.id).toBe(
        f.tm,
      );
      expect(b.db.listProjectTermEntries(id)[0].tbId).toBe(f.tb);
      expect(b.db.listProjectTermEntries(id)[0].tgtTerm).toBe('果园');
    }
    const tmHash = f.resources.get(f.tm)!.manifest.data[0];
    expect(f.download.mock.calls.filter(([hashes]) => hashes.includes(tmHash))).toHaveLength(1);
    f.upload.mockClear();
    await b.synchronize(first);
    expect(f.upload).not.toHaveBeenCalled();
    expect(b.status(first).pending).toBe(false);
  });

  it('syncs resource-only edits without creating new project versions', async () => {
    const f = await seeded();
    const b = await f.session('b');
    const bFirst = await b.openProject(f.firstUUID);
    const bSecond = await b.openProject(f.secondUUID);
    f.a.db.renameTM(f.tm, 'Shared renamed TM');
    f.a.db.upsertTBEntryBySrcTerm({
      id: 'orchard-term',
      tbId: f.tb,
      srcLang: 'en',
      srcTerm: 'orchard',
      tgtTerm: '新果园',
    });
    await f.a.synchronize();
    expect(f.projects.get(f.firstUUID)!.revision).toBe(1);
    expect(f.projects.get(f.secondUUID)!.revision).toBe(1);
    expect(f.resources.get(f.tm)!.revision).toBe(2);
    expect(f.resources.get(f.tb)!.revision).toBe(2);
    expect(f.a.hasPending()).toBe(false);
    await b.synchronize(bFirst);
    expect(b.db.getTM(f.tm)!.name).toBe('Shared renamed TM');
    expect(b.db.listProjectTermEntries(bFirst)[0].tgtTerm).toBe('新果园');
    expect(b.db.listProjectTermEntries(bSecond)[0].tgtTerm).toBe('新果园');
    expect(b.hasPending()).toBe(false);
  });

  it('downloads a newer TB and project without treating derived QA invalidation as local edits', async () => {
    const f = await seeded();
    const qa = [{ ruleId: 'terminology', severity: 'warning' as const, message: 'Synthetic QA' }];
    f.a.db.updateSegmentQaIssues('orchard-segment', qa);
    await f.a.synchronize(f.first);
    const b = await f.session('b');
    const bFirst = await b.openProject(f.firstUUID);
    expect(b.db.getSegment('orchard-segment')!.qaIssues).toEqual(qa);
    expect(b.hasPending()).toBe(false);
    f.a.db.upsertTBEntryBySrcTerm({
      id: 'orchard-term',
      tbId: f.tb,
      srcLang: 'en',
      srcTerm: 'orchard',
      tgtTerm: '新果园',
    });
    f.a.db.updateProjectAISettings(f.first, 'Published project update', '');
    await f.a.synchronize(f.first);
    const revision = f.projects.get(f.firstUUID)!.revision;
    const commits = f.commits(f.firstUUID).length;
    await b.synchronize(bFirst);
    expect(b.db.getProject(bFirst)!.aiPrompt).toBe('Published project update');
    expect(b.db.listProjectTermEntries(bFirst)[0].tgtTerm).toBe('新果园');
    expect(b.db.getSegment('orchard-segment')!.qaIssues).toBeUndefined();
    expect(b.tracker.get('project', f.firstUUID)!.revision).toBe(revision);
    expect(b.status(bFirst)).toMatchObject({ pending: false, conflict: false });
    expect(f.commits(f.firstUUID)).toHaveLength(commits);
  });

  it('preserves a real project draft while downloading a TB that invalidates its QA', async () => {
    const f = await seeded();
    const qa = [{ ruleId: 'terminology', severity: 'warning' as const, message: 'Synthetic QA' }];
    f.a.db.updateSegmentQaIssues('orchard-segment', qa);
    await f.a.synchronize(f.first);
    const b = await f.session('b');
    const bFirst = await b.openProject(f.firstUUID);
    const baseline = b.tracker.get('project', f.firstUUID)!.revision;
    b.db.updateProjectAISettings(bFirst, 'Device B unpublished draft', '');
    f.a.db.upsertTBEntryBySrcTerm({
      id: 'orchard-term',
      tbId: f.tb,
      srcLang: 'en',
      srcTerm: 'orchard',
      tgtTerm: '新果园',
    });
    f.a.db.updateProjectAISettings(f.first, 'Device A published project', '');
    await f.a.synchronize(f.first);
    await expect(b.synchronize(bFirst)).rejects.toThrow('both have changes');
    expect(b.db.getProject(bFirst)!.aiPrompt).toBe('Device B unpublished draft');
    expect(b.db.listProjectTermEntries(bFirst)[0].tgtTerm).toBe('新果园');
    expect(b.db.getSegment('orchard-segment')!.qaIssues).toBeUndefined();
    expect(b.tracker.get('project', f.firstUUID)!.revision).toBe(baseline);
    expect(b.getConflicts().map(({ kind, id }) => ({ kind, id }))).toEqual([
      { kind: 'project', id: f.firstUUID },
    ]);
    expect(b.status(bFirst)).toMatchObject({ pending: true, conflict: true });
  });

  it('preserves conflicting shared-resource drafts across restart', async () => {
    const f = await seeded();
    const b = await f.session('b');
    const bFirst = await b.openProject(f.firstUUID);
    f.a.db.renameTM(f.tm, 'Device A');
    b.db.renameTM(f.tm, 'Device B draft');
    await f.a.synchronize(f.first);
    await expect(b.synchronize(bFirst)).rejects.toThrow('both have changes');
    expect(b.status(bFirst)).toMatchObject({
      conflict: true,
      pending: true,
      project: { writable: true },
    });
    expect(b.getConflicts().map(({ kind, id }) => ({ kind, id }))).toEqual([
      { kind: 'tm', id: f.tm },
    ]);
    close(b);
    const reopened = await f.session('b');
    expect(reopened.db.getTM(f.tm)!.name).toBe('Device B draft');
    expect(reopened.status(bFirst).pending).toBe(true);
    const fresh = await f.session('fresh');
    await fresh.openProject(f.firstUUID);
    expect(fresh.db.getTM(f.tm)!.name).toBe('Device A');
  });

  it('handles a server CAS conflict arising after the initial catalog read', async () => {
    const f = await seeded();
    f.a.db.updateSegmentTarget('orchard-segment', [{ type: 'text', content: '本地草稿' }], 'draft');
    f.advanceBeforeCommit(f.firstUUID);
    await expect(f.a.synchronize(f.first)).rejects.toThrow('both have changes');
    expect(f.a.getConflicts().map((row) => row.kind)).toEqual(['project']);
    expect(f.a.tracker.get('project', f.firstUUID)!.pending).toBeTruthy();
    expect(f.a.db.getSegment('orchard-segment')!.targetTokens).toEqual([
      { type: 'text', content: '本地草稿' },
    ]);
    expect(f.a.status(f.first).project?.writable).toBe(true);
  });

  it('preserves a stale device project draft without changing the other device publication', async () => {
    const f = await seeded();
    const b = await f.session('b');
    const bFirst = await b.openProject(f.firstUUID);
    f.a.db.updateSegmentTarget(
      'orchard-segment',
      [{ type: 'text', content: '设备 A 的译文' }],
      'draft',
    );
    b.db.updateSegmentTarget(
      'orchard-segment',
      [{ type: 'text', content: '设备 B 的草稿' }],
      'draft',
    );
    await f.a.synchronize(f.first);
    await expect(b.synchronize(bFirst)).rejects.toThrow('both have changes');
    expect(f.projects.get(f.firstUUID)!.revision).toBe(2);
    expect(b.tracker.get('project', f.firstUUID)!.revision).toBe(1);
    close(b);
    const reopened = await f.session('b');
    expect(reopened.db.getSegment('orchard-segment')!.targetTokens).toEqual([
      { type: 'text', content: '设备 B 的草稿' },
    ]);
    expect(reopened.status(bFirst).pending).toBe(true);
    const fresh = await f.session('fresh');
    await fresh.openProject(f.firstUUID);
    expect(fresh.db.getSegment('orchard-segment')!.targetTokens).toEqual([
      { type: 'text', content: '设备 A 的译文' },
    ]);
  });

  it('retries the exact durable operation after a lost reply, then publishes newer local data', async () => {
    const f = await seeded();
    f.a.db.updateProjectAISettings(f.first, 'First remote edit', '');
    f.loseReply(f.firstUUID);
    await expect(f.a.synchronize(f.first)).rejects.toThrow('Response interrupted');
    const pending = f.a.tracker.get('project', f.firstUUID)!.pending;
    expect(pending).toBeTruthy();
    f.a.db.updateProjectAISettings(f.first, 'Later local edit', '');
    writeFileSync(f.original, 'later original file bytes');
    close(f.a);
    const reopened = await f.session('a');
    expect(reopened.tracker.get('project', f.firstUUID)!.pending).toBe(pending);
    await reopened.synchronize(f.first);
    const calls = f.commits(f.firstUUID);
    expect(calls).toHaveLength(3);
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[2].operationId).not.toBe(calls[0].operationId);
    expect(calls[2].revision).toBe(2);
    expect(f.projects.get(f.firstUUID)!.revision).toBe(3);
    expect(reopened.status(f.first).pending).toBe(false);
    const remote = f.projects.get(f.firstUUID)!;
    const snapshot = JSON.parse(
      (await f.download(remote.manifest.state)).toString(),
    ) as ProjectSnapshotV2;
    expect(snapshot.project.aiPrompt).toBe('Later local edit');
    expect((await f.download(remote.manifest.files[0].chunks)).toString()).toBe(
      'later original file bytes',
    );
  });

  it('keeps already acknowledged objects clean after a later object fails', async () => {
    const f = await seeded();
    f.a.db.renameTM(f.tm, 'Confirmed resource');
    f.a.db.renameTermBase(f.tb, 'Pending resource');
    f.failCommit(f.tb);
    await expect(f.a.synchronize(f.first)).rejects.toThrow('Commit interrupted');
    const confirmed = f.a.tracker.get('tm', f.tm)!;
    expect(confirmed.generation).toBe(confirmed.confirmed);
    expect(confirmed.pending).toBeNull();
    expect(f.a.tracker.get('tb', f.tb)!.pending).toBeTruthy();
    expect(f.projects.get(f.firstUUID)!.revision).toBe(1);
    await f.a.synchronize(f.first);
    expect(f.commits(f.tm)).toHaveLength(1);
    expect(f.commits(f.tb)).toHaveLength(2);
    expect(f.commits(f.tb)[1]).toEqual(f.commits(f.tb)[0]);
    expect(f.a.hasPending()).toBe(false);
  });

  it('preserves the installed project and original files when a download is interrupted', async () => {
    const f = await seeded();
    const b = await f.session('b');
    const bFirst = await b.openProject(f.firstUUID);
    const file = b.db.listFiles(bFirst)[0];
    const destination = join(b.projectsDir, String(bFirst), `${file.id}_${file.name}`);
    f.a.db.updateProjectAISettings(f.first, 'Cloud update', '');
    writeFileSync(f.original, 'updated remote file');
    await f.a.synchronize(f.first);
    f.failDownload(f.projects.get(f.firstUUID)!.manifest.files[0].chunks[0]);
    await expect(b.synchronize(bFirst)).rejects.toThrow('Download interrupted');
    expect(b.db.getProject(bFirst)!.aiPrompt).not.toBe('Cloud update');
    expect(readFileSync(destination, 'utf8')).toBe('original file fixture');
    expect(b.tracker.get('project', f.firstUUID)!.revision).toBe(1);
    expect(b.hasPending()).toBe(false);
    await b.synchronize(bFirst);
    expect(b.db.getProject(bFirst)!.aiPrompt).toBe('Cloud update');
    expect(readFileSync(destination, 'utf8')).toBe('updated remote file');
    expect(b.hasPending()).toBe(false);
  });
});
