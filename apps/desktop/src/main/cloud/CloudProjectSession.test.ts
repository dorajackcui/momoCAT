import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATDatabase, exportCloudProject } from '@cat/db';
import type { CloudProject } from '@cat/cloud-contracts';
import { CloudProjectSession } from './CloudProjectSession';
import { CloudConnection, CloudRequestError, cloudChunkHashes } from './CloudConnection';

vi.mock('electron', () => ({ safeStorage: {}, shell: {} }));

describe('cloud cache sessions', () => {
  const directories: string[] = [];
  const sessions: CloudProjectSession[] = [];
  afterEach(() => {
    sessions.splice(0).forEach((s) => s.dispose());
    directories.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
  });

  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'momocat-cloud-session-'));
    directories.push(directory);
    const path = join(directory, 'original.db');
    const db = new CATDatabase(path);
    const projectId = db.createProject('Cloud fixture', 'en', 'zh');
    db.close();
    const snapshot = exportCloudProject(path, projectId);
    const blobs = new Map<string, Buffer>();
    const upload = vi.fn(async (data: Uint8Array) => {
      const hashes = cloudChunkHashes(data);
      blobs.set(hashes[0], Buffer.from(data));
      return hashes;
    });
    const initialState = Buffer.from(JSON.stringify(snapshot.state));
    const initialResources = Buffer.from(JSON.stringify(snapshot.resources));
    const stateHash = cloudChunkHashes(initialState)[0];
    const resourceHash = cloudChunkHashes(initialResources)[0];
    blobs.set(stateHash, initialState);
    blobs.set(resourceHash, initialResources);
    const remote: CloudProject = {
      id: 'project',
      name: 'Cloud fixture',
      revision: 1,
      updatedAt: 1,
      manifest: {
        protocol: 1,
        schema: 15,
        state: [stateHash],
        resources: [resourceHash],
        files: [],
      },
    };
    let loseResponse = false;
    const operations = new Map<string, number>();
    const json = vi.fn(async (route: string, _method: string, body: Record<string, unknown>) => {
      if (!_method || _method === 'GET') return structuredClone(remote);
      if (route.endsWith('/commit')) {
        const operation = String(body.operationId);
        if (!operations.has(operation)) {
          if (body.revision !== remote.revision)
            throw new CloudRequestError(409, 'Newer cloud version');
          remote.revision++;
          remote.manifest = body.manifest as CloudProject['manifest'];
          operations.set(operation, remote.revision);
        }
        if (loseResponse) {
          loseResponse = false;
          throw new Error('Connection interrupted');
        }
        return { revision: operations.get(operation) };
      }
      return {};
    });
    const connection = {
      upload,
      download: vi.fn(async (hashes: string[]) => Buffer.concat(hashes.map((h) => blobs.get(h)!))),
      json,
    } as unknown as CloudConnection;
    const session = (device = 'cache') => {
      const value = new CloudProjectSession(
        structuredClone(remote),
        connection,
        join(directory, device),
      );
      sessions.push(value);
      return value;
    };
    return {
      remote,
      session,
      projectId,
      upload,
      json,
      operations,
      loseResponse: () => {
        loseResponse = true;
      },
    };
  }

  it('saves locally without timers or leases, and uploads only on explicit save', async () => {
    const f = fixture();
    const session = f.session();
    await session.open();
    vi.useFakeTimers();
    try {
      session.db.updateProjectAISettings(f.projectId, 'Edit from device A', '');
      await vi.advanceTimersByTimeAsync(65_000);
      expect(f.json).not.toHaveBeenCalled();
      expect(f.upload).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
    expect(session.status().pending).toBe(true);
    await session.sync();
    expect(f.upload).toHaveBeenCalledTimes(2);
    expect(session.status()).toMatchObject({ pending: false, revision: 2, writable: true });
    session.db.updateProjectAISettings(f.projectId, 'Local draft', '');
    session.dispose();
    const reopened = f.session();
    await reopened.open();
    expect(reopened.db.getProject(f.projectId)?.aiPrompt).toBe('Local draft');
    expect(reopened.status().pending).toBe(true);
    expect(f.upload).toHaveBeenCalledTimes(2);
  });
  it('retries a lost response after restart, then publishes subsequent local edits', async () => {
    const f = fixture();
    const session = f.session();
    await session.open();
    session.db.updateProjectAISettings(f.projectId, 'Confirmed remotely', '');
    f.loseResponse();
    await expect(session.sync()).rejects.toThrow('interrupted');
    expect(session.writable).toBe(true);
    session.db.updateProjectAISettings(f.projectId, 'Still pending locally', '');
    session.dispose();
    const reopened = f.session();
    await reopened.open();
    expect(reopened.status()).toMatchObject({ revision: 1, pending: true });
    expect(reopened.db.getProject(f.projectId)?.aiPrompt).toBe('Still pending locally');
    await reopened.sync();
    expect(reopened.status()).toMatchObject({ revision: 3, pending: false });
    expect(f.operations.size).toBe(2);
  });
  it('allows two devices to edit, rejects stale saves and preserves the losing draft across restart', async () => {
    const f = fixture();
    const a = f.session('a');
    const b = f.session('b');
    await a.open();
    await b.open();
    expect(a.writable && b.writable).toBe(true);
    a.db.updateProjectAISettings(f.projectId, 'Device A', '');
    b.db.updateProjectAISettings(f.projectId, 'Device B', '');
    await a.sync();
    await expect(b.sync()).rejects.toThrow('Newer cloud version');
    expect(b.status()).toMatchObject({ revision: 1, pending: true, writable: true });
    b.dispose();
    const reopened = f.session('b');
    await reopened.open();
    expect(reopened.db.getProject(f.projectId)?.aiPrompt).toBe('Device B');
    const fresh = f.session('fresh');
    await fresh.open();
    expect(fresh.db.getProject(f.projectId)?.aiPrompt).toBe('Device A');
  });
  it('relays files, TM/TB edits, mount permissions and unmounted project resources', async () => {
    const f = fixture();
    const a = f.session('a');
    await a.open();
    const tm = a.db.createTM('Project TM', 'en', 'zh', 'main');
    a.db.mountTMToProject(f.projectId, tm, 3, 'write');
    const tb = a.db.createTermBase('Project TB', 'en', 'zh');
    a.db.mountTermBaseToProject(f.projectId, tb);
    a.db.insertTBEntryIfAbsentBySrcTerm({
      id: 'term',
      tbId: tb,
      srcLang: 'en',
      srcTerm: 'orchard',
      tgtTerm: '果园',
    });
    a.db.createTermBase('Not mounted yet', 'en', 'zh');
    const fileId = a.db.createFile(f.projectId, 'source.xlsx');
    mkdirSync(join(a.projectsDir, String(f.projectId)), { recursive: true });
    writeFileSync(
      join(a.projectsDir, String(f.projectId), `${fileId}_source.xlsx`),
      'original file fixture',
    );
    await a.sync();
    const b = f.session('b');
    await b.open();
    expect(b.db.listFiles(f.projectId)).toHaveLength(1);
    expect(b.db.listTermBases()).toHaveLength(2);
    expect(b.db.getProjectMountedTMs(f.projectId).find((t) => t.id === tm)?.permission).toBe(
      'write',
    );
    expect(b.db.listProjectTermEntries(f.projectId)).toEqual(
      a.db.listProjectTermEntries(f.projectId),
    );
  });
});
