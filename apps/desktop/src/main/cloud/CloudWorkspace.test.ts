import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMain } from 'electron';
import {
  CATDatabase,
  exportCloudAccountProject,
  exportCloudResource,
  type ProjectSnapshotV2,
} from '@cat/db';
import type { AIRuntimeConfigService } from '@cat/localization';
import {
  MAX_BLOB_BYTES,
  parseProjectManifestV2,
  parseResourceManifestV2,
  type CloudProjectV2,
  type CloudResourceV2,
} from '@cat/cloud-contracts';
import type { IpcMainListener } from '../ipc/types';
import { IPC_CHANNELS as C } from '../../shared/ipcChannels';
import { CLOUD_CHANNELS as CC } from '../../shared/cloud';
import { IpcContextRouter } from './IpcContextRouter';
import { CloudWorkspace } from './CloudWorkspace';
import { CloudRequestError, cloudChunkHashes } from './CloudConnection';
import { cloudReads, cloudWrites } from './cloudPolicy';

const harness = vi.hoisted(() => ({
  connection: {} as Record<string, unknown>,
  windows: new Map<number, unknown>(),
}));
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: (sender: { id: number }) => harness.windows.get(sender.id) },
  safeStorage: {},
  shell: {},
}));
vi.mock('./CloudConnection', async (original) => ({
  ...(await original<typeof import('./CloudConnection')>()),
  CloudConnection: class {
    constructor() {
      return harness.connection;
    }
  },
}));
vi.mock('../services/referenceLookup/ReferenceLookupWorkerManager', () => ({
  ReferenceLookupWorkerManager: class {
    async dispose() {}
    async invalidateReferenceData() {}
  },
}));

class TestWindow extends EventEmitter {
  webContents: { id: number; send: ReturnType<typeof vi.fn> };
  constructor(id = 42) {
    super();
    this.webContents = { id, send: vi.fn() };
  }
  setTitle = vi.fn();
  destroyed = false;
  isDestroyed = () => this.destroyed;
  close = vi.fn(() => {
    const event = { preventDefault: vi.fn() };
    this.emit('close', event);
    if (!event.preventDefault.mock.calls.length) {
      this.destroyed = true;
      this.emit('closed');
    }
  });
}
function deferred() {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    resolve: () => resolve(),
  };
}
interface AccountCatalog {
  projects: Map<string, CloudProjectV2>;
  resources: Map<string, CloudResourceV2>;
}

describe('V2 account workspace context', () => {
  let directory: string;
  let local: CATDatabase;
  let workspace: CloudWorkspace;
  let router: IpcContextRouter;
  let window: TestWindow;
  let handlers: Map<string, IpcMainListener>;
  let remote: CloudProjectV2;
  let other: CloudProjectV2;
  let bob: CloudProjectV2;
  let tm: string;
  let tb: string;
  let localTM: string;
  let blobs: Map<string, Buffer>;
  let accounts: Map<string, AccountCatalog>;
  let json: ReturnType<typeof vi.fn>;
  let onCloseCancelled: ReturnType<typeof vi.fn>;
  let localProjectsDir: string;
  const callAs = (senderId: number, channel: string, ...args: unknown[]) =>
    Promise.resolve().then(() => handlers.get(channel)!({ sender: { id: senderId } }, ...args));
  const call = (channel: string, ...args: unknown[]) => callAs(42, channel, ...args);
  const storeBytes = (bytes: Uint8Array) => {
    const hashes = cloudChunkHashes(bytes);
    hashes.forEach((hash, index) =>
      blobs.set(
        hash,
        Buffer.from(bytes.subarray(index * MAX_BLOB_BYTES, (index + 1) * MAX_BLOB_BYTES)),
      ),
    );
    return hashes;
  };
  const store = (value: unknown) => storeBytes(Buffer.from(JSON.stringify(value)));
  const state = (project: CloudProjectV2): ProjectSnapshotV2 =>
    JSON.parse(Buffer.concat(project.manifest.state.map((hash) => blobs.get(hash)!)).toString());
  const revise = (project: CloudProjectV2, change: (snapshot: ProjectSnapshotV2) => void) => {
    const snapshot = state(project);
    change(snapshot);
    project.manifest.state = store(snapshot);
    project.revision++;
  };
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'momocat-v2-workspace-'));
    local = new CATDatabase(join(directory, 'local.db'));
    local.createProject('Local project', 'en', 'zh');
    localTM = local.createTM('Local only TM', 'en', 'zh', 'main');
    localProjectsDir = join(directory, 'local-projects');
    mkdirSync(localProjectsDir, { recursive: true });
    blobs = new Map();
    accounts = new Map();
    const seedPath = join(directory, 'remote.db');
    const seed = new CATDatabase(seedPath);
    const first = seed.createProject('Cloud project', 'en', 'zh');
    const second = seed.createProject('Other cloud project', 'en', 'zh');
    tm = seed.createTM('Shared TM', 'en', 'zh', 'main');
    tb = seed.createTermBase('Shared TB', 'en', 'zh');
    seed.insertTBEntryIfAbsentBySrcTerm({
      id: 'term',
      tbId: tb,
      srcLang: 'en',
      srcTerm: 'orchard',
      tgtTerm: '果园',
    });
    for (const id of [first, second]) {
      seed.mountTMToProject(id, tm, 3, 'readwrite');
      seed.mountTermBaseToProject(id, tb, 4);
    }
    const firstFile = seed.createFile(first, 'source.xlsx');
    const secondFile = seed.createFile(first, 'notes.xlsx');
    const seedSQL = new Database(seedPath);
    seedSQL.prepare('UPDATE files SET createdAt=? WHERE id=?').run('2026-01-01', firstFile);
    seedSQL.prepare('UPDATE files SET createdAt=? WHERE id=?').run('2026-01-02', secondFile);
    seedSQL.close();
    seed.close();
    const alice: AccountCatalog = { projects: new Map(), resources: new Map() };
    for (const [kind, id] of [
      ['tm', tm],
      ['tb', tb],
    ] as const) {
      const snapshot = exportCloudResource(seedPath, kind, id);
      alice.resources.set(id, {
        id,
        kind,
        name: snapshot.resource.name,
        srcLang: 'en',
        tgtLang: 'zh',
        revision: 1,
        updatedAt: 1,
        manifest: { protocol: 2, schema: 15, kind, data: store(snapshot) },
      });
    }
    const project = (path: string, id: number): CloudProjectV2 => {
      const snapshot = exportCloudAccountProject(path, id);
      return {
        id: snapshot.project.uuid,
        name: snapshot.project.name,
        revision: 1,
        updatedAt: 1,
        manifest: {
          protocol: 2,
          schema: 15,
          state: store(snapshot),
          files: snapshot.files.map((file) => ({
            id: file.uuid,
            chunks: storeBytes(Buffer.from(`original ${file.name}`)),
          })),
          resources: [
            ...snapshot.mounts.tms
              .filter((mount) => mount.tmId !== snapshot.workingTM?.resource.id)
              .map((mount) => ({ id: mount.tmId, kind: 'tm' as const })),
            ...snapshot.mounts.tbs.map((mount) => ({ id: mount.tbId, kind: 'tb' as const })),
          ],
        },
      };
    };
    remote = project(seedPath, first);
    other = project(seedPath, second);
    alice.projects.set(remote.id, remote);
    alice.projects.set(other.id, other);
    accounts.set('alice', alice);
    const bobPath = join(directory, 'bob-seed.db');
    const bobDB = new CATDatabase(bobPath);
    const bobId = bobDB.createProject('Bob project', 'ja', 'en');
    bobDB.close();
    bob = project(bobPath, bobId);
    accounts.set('bob', { projects: new Map([[bob.id, bob]]), resources: new Map() });
    const operations = new Map<string, { payload: string; revision: number }>();
    json = vi.fn(
      async (route: string, method = 'GET', body?: Record<string, unknown>): Promise<unknown> => {
        const account = harness.connection.account as { id: string } | null;
        if (!account) throw new CloudRequestError(401, 'Sign in first');
        const catalog = accounts.get(account.id)!;
        const parts = route.split('/').filter(Boolean);
        if (parts[0] === 'v1') {
          if (method === 'GET' && parts.length === 2) return [];
          throw new CloudRequestError(404, 'Object not found');
        }
        const projects = parts[1] === 'projects';
        const entries = projects ? catalog.projects : catalog.resources;
        const id = parts[2];
        if (method === 'GET') {
          if (!id) return structuredClone([...entries.values()]);
          const entry = entries.get(id);
          if (!entry) throw new CloudRequestError(404, 'Object not found');
          return structuredClone(entry);
        }
        if (method !== 'POST' || !body) throw new Error('Unexpected request');
        const manifest = projects
          ? parseProjectManifestV2(body.manifest)
          : parseResourceManifestV2(body.manifest);
        if (!id) {
          const entry = {
            id: String(body.id),
            name: String(body.name),
            revision: 1,
            updatedAt: 1,
            manifest,
            ...(projects ? {} : { kind: body.kind, srcLang: body.srcLang, tgtLang: body.tgtLang }),
          };
          if (projects) catalog.projects.set(entry.id, entry as CloudProjectV2);
          else catalog.resources.set(entry.id, entry as CloudResourceV2);
          return structuredClone(entry);
        }
        const operation = `${account.id}:${route}:${String(body.operationId)}`;
        const payload = JSON.stringify(body);
        const previous = operations.get(operation);
        if (previous) {
          if (previous.payload !== payload) throw new CloudRequestError(409, 'Operation reused');
          return { revision: previous.revision };
        }
        const entry = entries.get(id);
        if (!entry) throw new CloudRequestError(404, 'Object not found');
        if (body.revision !== entry.revision)
          throw new CloudRequestError(409, 'Newer cloud version');
        const replacement = {
          ...entry,
          manifest,
          name: body.name === undefined ? entry.name : String(body.name),
          revision: entry.revision + 1,
        };
        if (projects) catalog.projects.set(id, replacement as CloudProjectV2);
        else catalog.resources.set(id, replacement as CloudResourceV2);
        operations.set(operation, { payload, revision: replacement.revision });
        return { revision: replacement.revision };
      },
    );
    harness.connection = {
      baseURL: 'https://cloud.example',
      account: { id: 'alice', name: 'Alice', email: 'alice@example.test' },
      initialize: vi.fn(),
      json,
      logout: vi.fn(async () => {
        harness.connection.account = null;
      }),
      upload: async (bytes: Uint8Array) => storeBytes(bytes),
      download: async (hashes: string[]) => Buffer.concat(hashes.map((hash) => blobs.get(hash)!)),
    };
    window = new TestWindow();
    harness.windows.clear();
    harness.windows.set(42, window);
    handlers = new Map();
    const ipc = {
      handle: (channel: string, fn: IpcMainListener) => {
        handlers.set(channel, fn);
      },
    };
    router = new IpcContextRouter(ipc);
    for (const channel of new Set([...cloudReads, ...cloudWrites]))
      router.local.handle(channel, () => 'local');
    router.local.handle(C.project.get, (_event, id) => local.getProject(Number(id)));
    router.local.handle(C.project.list, () => local.listProjects());
    router.local.handle(C.tm.list, () => local.listTMs('main'));
    router.local.handle(C.tb.list, () => local.listTermBases());
    onCloseCancelled = vi.fn();
    workspace = new CloudWorkspace({
      ipcMain: ipc as IpcMain,
      router,
      userDataPath: directory,
      localDb: local,
      localDbPath: join(directory, 'local.db'),
      localProjectsDir,
      runtime: {} as AIRuntimeConfigService,
      onCloseCancelled,
    });
    await workspace.initialize();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await workspace.dispose();
    local.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('isolates equal numeric local/cloud IDs and reopens a retained local cloud draft', async () => {
    expect(await call(CC.cloudOpenProject, remote.id)).toBe(1);
    expect(await call(C.project.get, 1)).toMatchObject({ name: 'Cloud project', uuid: remote.id });
    expect(await call(C.project.list)).toMatchObject([{ name: 'Local project' }]);
    await call(C.project.updatePrompt, 1, 'Cloud draft');
    expect(local.getProject(1)?.aiPrompt).not.toBe('Cloud draft');
    await expect(call(CC.cloudCloseProject)).rejects.toThrow('keeping changes');
    await expect(call(CC.cloudPull)).rejects.toThrow('Local changes');
    await call(CC.cloudCloseProject, true);
    expect(await call(C.project.get, 1)).toMatchObject({ name: 'Local project' });
    expect(json.mock.calls.some(([route]) => route.endsWith('/commit'))).toBe(false);
    await call(CC.cloudOpenProject, remote.id);
    expect(await call(C.project.get, 1)).toMatchObject({ aiPrompt: 'Cloud draft' });
  });

  it('switches cloud projects and resource managers without discarding another cloud draft', async () => {
    await call(CC.cloudOpenProject, remote.id);
    await call(C.project.updatePrompt, 1, 'Keep on this device');
    expect(await call(CC.cloudOpenProject, other.id)).toBe(2);
    expect(await call(CC.cloudStatus)).toMatchObject({
      context: 'cloud',
      pending: false,
      pendingElsewhere: true,
      project: { id: other.id },
    });
    await call(CC.cloudOpenResources, 'tm');
    expect(await call(CC.cloudStatus)).toMatchObject({
      context: 'cloud',
      resourceKind: 'tm',
      pendingElsewhere: true,
    });
    await call(CC.cloudOpenProject, remote.id);
    expect(await call(C.project.get, 1)).toMatchObject({ aiPrompt: 'Keep on this device' });
    expect(json.mock.calls.some(([route]) => route.endsWith('/commit'))).toBe(false);
  });

  it('uses one shared cloud resource catalog and copies local resources independently', async () => {
    await call(CC.cloudOpenResources, 'tm');
    expect(await call(C.tm.list, 'main')).toMatchObject([{ id: tm, name: 'Shared TM' }]);
    expect(await call(C.tb.list)).toMatchObject([{ id: tb, name: 'Shared TB' }]);
    expect(await call(CC.cloudListLocalResources, 'tm')).toMatchObject([{ id: localTM }]);
    const copied = (await call(CC.cloudCopyResource, 'tm', localTM)) as {
      id: string;
      name: string;
    };
    expect(copied.id).not.toBe(localTM);
    expect(copied.name).toBe('Local only TM');
    const created = (await call(C.tm.create, 'Reusable cloud TM', 'en', 'zh', 'main')) as string;
    await call(CC.cloudOpenProject, remote.id);
    await call(C.tm.mount, 1, created, 5, 'readwrite');
    await call(CC.cloudOpenProject, other.id);
    await call(C.tm.mount, 2, created, 6, 'read');
    await call(CC.cloudSync, true);
    for (const id of [remote.id, other.id])
      expect(accounts.get('alice')!.projects.get(id)!.manifest.resources).toContainEqual({
        id: created,
        kind: 'tm',
      });
    expect(local.listTMs('main').map((resource) => resource.id)).toEqual([localTM]);
  });

  it('blocks writes, account changes and context replacements during synchronization', async () => {
    await call(CC.cloudOpenProject, remote.id);
    const entered = deferred();
    const gate = deferred();
    const originalJSON = harness.connection.json as typeof json;
    harness.connection.json = async (
      route: string,
      method?: string,
      body?: Record<string, unknown>,
    ) => {
      if (route === '/v2/projects' && (!method || method === 'GET')) {
        entered.resolve();
        await gate.promise;
      }
      return originalJSON(route, method, body);
    };
    const syncing = call(CC.cloudSync);
    await entered.promise;
    try {
      expect(await call(CC.cloudStatus)).toMatchObject({ syncing: true });
      await expect(call(C.project.updatePrompt, 1, 'Too late')).rejects.toThrow('synchronization');
      await expect(call(CC.cloudOpenProject, other.id)).rejects.toThrow('active operations');
      await expect(call(CC.cloudOpenResources, 'tb')).rejects.toThrow('active operations');
      await expect(call(CC.cloudCloseProject, true)).rejects.toThrow('active operations');
      await expect(call(CC.cloudLogout)).rejects.toThrow('Leave cloud projects');
    } finally {
      gate.resolve();
      await syncing;
      harness.connection.json = originalJSON;
    }
    expect(await call(C.project.get, 1)).toMatchObject({ name: 'Cloud project' });
  });

  it('blocks existing cloud windows while another cloud context is opening', async () => {
    await call(CC.cloudOpenProject, remote.id);
    harness.windows.set(43, new TestWindow(43));
    await callAs(43, CC.cloudOpenProject, remote.id);
    const entered = deferred();
    const gate = deferred();
    const originalJSON = harness.connection.json as typeof json;
    harness.connection.json = async (
      route: string,
      method?: string,
      body?: Record<string, unknown>,
    ) => {
      if (route === `/v2/projects/${other.id}` && (!method || method === 'GET')) {
        entered.resolve();
        await gate.promise;
      }
      return originalJSON(route, method, body);
    };
    const opening = call(CC.cloudOpenProject, other.id);
    await entered.promise;
    try {
      await expect(callAs(43, C.project.updatePrompt, 1, 'Concurrent write')).rejects.toThrow();
    } finally {
      gate.resolve();
      await opening;
      harness.connection.json = originalJSON;
    }
    expect(await callAs(43, C.project.get, 1)).not.toMatchObject({ aiPrompt: 'Concurrent write' });
    expect(await call(C.project.get, 2)).toMatchObject({ name: 'Other cloud project' });
  });

  it('waits for local IPC operations before entering cloud', async () => {
    const entered = deferred();
    const gate = deferred();
    router.local.handle(C.clipboard.read, async () => {
      entered.resolve();
      await gate.promise;
      return 'local';
    });
    const pending = call(C.clipboard.read);
    await entered.promise;
    try {
      await expect(call(CC.cloudOpenProject, remote.id)).rejects.toThrow('local operations');
    } finally {
      gate.resolve();
      await pending;
    }
    expect(await call(CC.cloudOpenProject, remote.id)).toBe(1);
  });

  it('keeps the current context usable after a failed pull or failed opening', async () => {
    await call(CC.cloudOpenProject, remote.id);
    revise(remote, (snapshot) => {
      snapshot.project.aiPrompt = 'New remote content';
    });
    const originalDownload = harness.connection.download;
    harness.connection.download = async () => {
      throw new Error('Network unavailable');
    };
    await expect(call(CC.cloudPull)).rejects.toThrow('Network unavailable');
    expect(await call(C.project.get, 1)).toMatchObject({ name: 'Cloud project' });
    harness.connection.download = originalDownload;
    await call(CC.cloudPull);
    expect(await call(C.project.get, 1)).toMatchObject({ aiPrompt: 'New remote content' });
    expect(await call(CC.cloudStatus)).toMatchObject({ project: { revision: 2, pending: false } });
    await expect(call(CC.cloudOpenProject, 'missing-project')).rejects.toThrow('Object not found');
    expect(await call(C.project.get, 1)).toMatchObject({ aiPrompt: 'New remote content' });
  });

  it('creates V2 projects directly using current main project types', async () => {
    const created = (await call(
      CC.cloudCreateProject,
      'New cloud project',
      'ja',
      'en',
      'custom',
    )) as { id: string };
    expect(local.listProjects()).toHaveLength(1);
    expect(json).toHaveBeenCalledWith(
      '/v2/projects',
      'POST',
      expect.objectContaining({ id: created.id, name: 'New cloud project' }),
    );
    const published = accounts.get('alice')!.projects.get(created.id)!;
    expect(state(published).project.projectType).toBe('custom');
    expect(created.id).toBe(state(published).project.uuid);
    await expect(call(CC.cloudCreateProject, 'Legacy type', 'ja', 'en', 'review')).rejects.toThrow(
      'Invalid project details',
    );
  });

  it('exposes a cache revision after a successful resource pull followed by project download failure', async () => {
    await call(CC.cloudOpenProject, remote.id);
    const before = (await call(CC.cloudStatus)) as { cacheRevision: number };
    const resource = accounts.get('alice')!.resources.get(tm)!;
    const snapshot = JSON.parse(
      Buffer.concat(resource.manifest.data.map((hash) => blobs.get(hash)!)).toString(),
    ) as { resource: { name: string } };
    snapshot.resource.name = 'Pulled TM';
    resource.name = 'Pulled TM';
    resource.manifest.data = store(snapshot);
    resource.revision++;
    revise(remote, (value) => {
      value.project.aiPrompt = 'Unavailable project update';
    });
    const originalDownload = harness.connection.download as (hashes: string[]) => Promise<Buffer>;
    harness.connection.download = async (hashes: string[]) => {
      if (hashes.includes(remote.manifest.state[0])) throw new Error('Project download failed');
      return originalDownload(hashes);
    };
    await expect(call(CC.cloudSync)).rejects.toThrow('Project download failed');
    expect(await call(C.tm.list, 'main')).toMatchObject([{ id: tm, name: 'Pulled TM' }]);
    expect(await call(C.project.get, 1)).not.toMatchObject({
      aiPrompt: 'Unavailable project update',
    });
    const after = (await call(CC.cloudStatus)) as { cacheRevision: number };
    expect(after.cacheRevision).toBeGreaterThan(before.cacheRevision);
  });

  it('isolates logout/account caches and restores the earlier account draft', async () => {
    await call(CC.cloudOpenProject, remote.id);
    await call(C.project.updatePrompt, 1, 'Alice local draft');
    await expect(call(CC.cloudLogout)).rejects.toThrow('Leave cloud projects');
    await call(CC.cloudLeaveContext, true);
    await call(CC.cloudLogout);
    expect(await call(CC.cloudStatus)).toMatchObject({ account: null });
    await expect(call(CC.cloudListProjects)).rejects.toThrow('Sign in first');
    harness.connection.account = { id: 'bob', name: 'Bob', email: 'bob@example.test' };
    expect(await call(CC.cloudListProjects)).toMatchObject([{ id: bob.id, name: 'Bob project' }]);
    expect(await call(CC.cloudOpenProject, bob.id)).toBe(1);
    expect(await call(C.project.get, 1)).toMatchObject({ name: 'Bob project' });
    await expect(call(CC.cloudOpenProject, remote.id)).rejects.toThrow('Object not found');
    expect(await call(C.project.get, 1)).toMatchObject({ name: 'Bob project' });
    await call(CC.cloudLeaveContext, true);
    await call(CC.cloudLogout);
    harness.connection.account = { id: 'alice', name: 'Alice', email: 'alice@example.test' };
    await call(CC.cloudOpenProject, remote.id);
    expect(await call(C.project.get, 1)).toMatchObject({ aiPrompt: 'Alice local draft' });
  });

  it('copies a conflict and its correctly matched original files before pulling the cloud version', async () => {
    await call(CC.cloudOpenProject, remote.id);
    await call(C.project.updatePrompt, 1, 'Local conflict draft');
    revise(remote, (snapshot) => {
      snapshot.project.aiPrompt = 'Cloud winner';
    });
    await expect(call(CC.cloudSync)).rejects.toThrow('both have changes');
    const result = (await call(CC.cloudResolveConflict)) as {
      localCopyProjectId: number;
      localCopyName: string;
    };
    const copy = local.getProject(result.localCopyProjectId)!;
    expect(copy.uuid).not.toBe(remote.id);
    expect(copy.aiPrompt).toBe('Local conflict draft');
    expect(result.localCopyName).toBe('Cloud project (local copy)');
    for (const file of local.listFiles(copy.id))
      expect(
        readFileSync(join(localProjectsDir, String(copy.id), `${file.id}_${file.name}`), 'utf8'),
      ).toBe(`original ${file.name}`);
    expect(await call(C.project.get, 1)).toMatchObject({ aiPrompt: 'Cloud winner' });
    expect(await call(CC.cloudStatus)).toMatchObject({
      conflict: false,
      project: { pending: false, revision: 2 },
    });
  });

  it('cancels native close and schedules closing only after its IPC response', async () => {
    await call(CC.cloudOpenProject, remote.id);
    window.close();
    expect(window.isDestroyed()).toBe(false);
    expect(window.webContents.send).toHaveBeenCalledWith('cloud-close-requested', null);
    await call('cloud-cancel-close');
    expect(onCloseCancelled).toHaveBeenCalledTimes(1);
    expect(workspace.hasOpenProjects).toBe(true);
    window.close.mockClear();
    vi.useFakeTimers();
    await call(CC.cloudLeaveContext, true, true);
    expect(window.close).not.toHaveBeenCalled();
    expect(window.isDestroyed()).toBe(false);
    expect(workspace.hasOpenProjects).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(window.isDestroyed()).toBe(true);
  });

  it('matches conflict-copy originals by source UUID even when file names are identical', async () => {
    const snapshot = state(remote);
    for (const file of snapshot.files) file.name = 'same.xlsx';
    remote.manifest.state = store(snapshot);
    remote.manifest.files.forEach((file, index) => {
      file.chunks = storeBytes(
        Buffer.from(index === 0 ? 'first original bytes' : 'second original bytes'),
      );
    });
    await call(CC.cloudOpenProject, remote.id);
    await call(C.project.updatePrompt, 1, 'Keep this draft');
    revise(remote, (value) => {
      value.project.aiPrompt = 'Cloud replacement';
    });
    await expect(call(CC.cloudSync)).rejects.toThrow('both have changes');
    const result = (await call(CC.cloudResolveConflict)) as { localCopyProjectId: number };
    const copied = local.listFiles(result.localCopyProjectId);
    expect(copied).toHaveLength(2);
    for (const file of copied) {
      const bytes = readFileSync(
        join(localProjectsDir, String(result.localCopyProjectId), `${file.id}_${file.name}`),
        'utf8',
      );
      expect(bytes).toBe(
        file.createdAt === '2026-01-01' ? 'first original bytes' : 'second original bytes',
      );
    }
  });

  it('reports and synchronizes all retained cloud drafts without switching the local database', async () => {
    workspace.watchWindow(window as unknown as import('electron').BrowserWindow);
    await call(CC.cloudOpenProject, remote.id);
    await call(C.project.updatePrompt, 1, 'First cloud draft');
    await call(CC.cloudOpenProject, other.id);
    await call(C.project.updatePrompt, 2, 'Second cloud draft');
    await call(C.tb.rename, tb, 'Edited shared TB');
    await call(CC.cloudLeaveContext, true);
    json.mockClear();
    const status = await call(CC.cloudStatus);
    expect(status).toMatchObject({ pending: true, account: { id: 'alice' } });
    expect(status).not.toHaveProperty('context');
    expect(status).not.toHaveProperty('resourceKind');
    expect((status as { project?: unknown }).project).toBeUndefined();
    expect(json).not.toHaveBeenCalled();
    expect(await call(C.project.get, 1)).toMatchObject({ name: 'Local project' });
    await expect(call(CC.cloudSync)).rejects.toThrow('Open a cloud project');
    const result = await call(CC.cloudSync, true);
    expect(result).toMatchObject({ projectId: undefined });
    expect(state(accounts.get('alice')!.projects.get(remote.id)!).project.aiPrompt).toBe(
      'First cloud draft',
    );
    expect(state(accounts.get('alice')!.projects.get(other.id)!).project.aiPrompt).toBe(
      'Second cloud draft',
    );
    expect(accounts.get('alice')!.resources.get(tb)).toMatchObject({ name: 'Edited shared TB' });
    expect(await call(CC.cloudStatus)).toMatchObject({ pending: false, pendingElsewhere: false });
    expect(workspace.hasWindow(42)).toBe(false);
    expect(await call(C.project.get, 1)).toMatchObject({ name: 'Local project', aiPrompt: null });
    expect(local.listTermBases()).toHaveLength(0);
  });

  it('preserves conflict originals and waits for local operations when recovery starts from local', async () => {
    await call(CC.cloudOpenProject, remote.id);
    await call(C.project.updatePrompt, 1, 'Preserved global draft');
    await call(CC.cloudLeaveContext, true);
    revise(remote, (snapshot) => {
      snapshot.project.aiPrompt = 'Remote winner';
    });
    await expect(call(CC.cloudSync, true)).rejects.toThrow('both have changes');
    expect(await call(CC.cloudStatus)).toMatchObject({ conflict: true, pendingElsewhere: true });
    const entered = deferred();
    const gate = deferred();
    router.local.handle(C.clipboard.read, async () => {
      entered.resolve();
      await gate.promise;
      return 'local';
    });
    const operation = call(C.clipboard.read);
    await entered.promise;
    try {
      await expect(call(CC.cloudResolveConflict)).rejects.toThrow('local operations');
      expect(local.listProjects()).toHaveLength(1);
    } finally {
      gate.resolve();
      await operation;
    }
    const result = (await call(CC.cloudResolveConflict)) as { localCopyProjectId: number };
    const copy = local.getProject(result.localCopyProjectId)!;
    expect(copy).toMatchObject({ aiPrompt: 'Preserved global draft' });
    expect(copy.uuid).not.toBe(remote.id);
    for (const file of local.listFiles(copy.id))
      expect(
        readFileSync(join(localProjectsDir, String(copy.id), `${file.id}_${file.name}`), 'utf8'),
      ).toBe(`original ${file.name}`);
    expect(workspace.hasWindow(42)).toBe(false);
    expect(await call(C.project.get, 1)).toMatchObject({ name: 'Local project' });
    expect(await call(CC.cloudStatus)).toMatchObject({ conflict: false, pendingElsewhere: false });
    await call(CC.cloudOpenProject, remote.id);
    expect(await call(C.project.get, 1)).toMatchObject({ aiPrompt: 'Remote winner' });
  });

  it('blocks global sync and recovery while another cloud window may hold unsaved editor work', async () => {
    await call(CC.cloudOpenProject, remote.id);
    harness.windows.set(43, new TestWindow(43));
    await callAs(43, CC.cloudOpenProject, other.id);
    await call(C.project.updatePrompt, 1, 'Keep first draft');
    json.mockClear();
    await expect(call(CC.cloudSync, true)).rejects.toThrow('Close other cloud windows');
    await expect(call(CC.cloudResolveConflict)).rejects.toThrow('Close other cloud windows');
    await call(CC.cloudLeaveContext, true);
    await expect(call(CC.cloudSync, true)).rejects.toThrow('Close other cloud windows');
    await expect(call(CC.cloudResolveConflict)).rejects.toThrow('Close other cloud windows');
    expect(json).not.toHaveBeenCalled();
    expect(local.listProjects()).toHaveLength(1);
    expect(await callAs(43, C.project.get, 2)).toMatchObject({ name: 'Other cloud project' });
    await callAs(43, CC.cloudLeaveContext, true);
    await call(CC.cloudOpenProject, remote.id);
    expect(await call(C.project.get, 1)).toMatchObject({ aiPrompt: 'Keep first draft' });
  });

  it('guards account changes and context opening during global synchronization from a local page', async () => {
    const entered = deferred();
    const gate = deferred();
    const originalJSON = harness.connection.json as typeof json;
    harness.connection.json = async (
      route: string,
      method?: string,
      body?: Record<string, unknown>,
    ) => {
      if (route === '/v2/projects') {
        entered.resolve();
        await gate.promise;
      }
      return originalJSON(route, method, body);
    };
    const syncing = call(CC.cloudSync, true);
    await entered.promise;
    try {
      const status = await call(CC.cloudStatus);
      expect(status).toMatchObject({ syncing: true });
      expect(status).not.toHaveProperty('context');
      await expect(call(CC.cloudLogout)).rejects.toThrow('synchronization');
      await expect(call(CC.cloudStartLogin)).rejects.toThrow('synchronization');
      await expect(call(CC.cloudPollLogin)).rejects.toThrow('synchronization');
      await expect(call(CC.cloudOpenProject, remote.id)).rejects.toThrow('synchronization');
      await expect(call(CC.cloudLeaveContext, true, true)).rejects.toThrow('synchronization');
      expect(await call(C.project.get, 1)).toMatchObject({ name: 'Local project' });
    } finally {
      gate.resolve();
      await syncing;
      harness.connection.json = originalJSON;
    }
  });

  it('does not start global transfers during asynchronous logout or expose the old account cache afterward', async () => {
    await call(CC.cloudOpenProject, remote.id);
    await call(C.project.updatePrompt, 1, 'Account-private draft');
    await call(CC.cloudLeaveContext, true);
    const entered = deferred();
    const gate = deferred();
    harness.connection.logout = async () => {
      entered.resolve();
      await gate.promise;
      harness.connection.account = null;
    };
    const logout = call(CC.cloudLogout);
    await entered.promise;
    try {
      await expect(call(CC.cloudSync, true)).rejects.toThrow('account change');
      await expect(call(CC.cloudOpenProject, remote.id)).rejects.toThrow('account change');
    } finally {
      gate.resolve();
      await logout;
    }
    const status = await call(CC.cloudStatus);
    expect(status).toMatchObject({ account: null });
    expect(status).not.toHaveProperty('pending');
    expect(status).not.toHaveProperty('pendingElsewhere');
    expect(status).not.toHaveProperty('error');
    expect(status).not.toHaveProperty('context');
    await expect(call(CC.cloudSync, true)).rejects.toThrow('Sign in first');
  });

  it('leaves clean local window close alone but retains the close guard after leaving a dirty cloud context', async () => {
    const cleanWindow = new TestWindow(43);
    workspace.watchWindow(cleanWindow as unknown as import('electron').BrowserWindow);
    cleanWindow.close();
    expect(cleanWindow.isDestroyed()).toBe(true);
    expect(cleanWindow.webContents.send).not.toHaveBeenCalled();
    await call(CC.cloudOpenProject, remote.id);
    await call(C.project.updatePrompt, 1, 'Retained cloud draft');
    await call(CC.cloudLeaveContext, true);
    window.close();
    expect(window.isDestroyed()).toBe(false);
    expect(window.webContents.send).toHaveBeenCalledWith('cloud-close-requested', null);
    await expect(call(CC.cloudLeaveContext, false, true)).rejects.toThrow('keeping changes');
    vi.useFakeTimers();
    await call(CC.cloudLeaveContext, true, true);
    expect(window.isDestroyed()).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(window.isDestroyed()).toBe(true);
  });

  it('loads pending account work at startup and protects native close before opening a cloud page', async () => {
    await call(CC.cloudOpenProject, remote.id);
    await call(C.project.updatePrompt, 1, 'Draft kept over restart');
    await workspace.dispose();
    workspace = new CloudWorkspace({
      ipcMain: {
        handle: (channel: string, fn: IpcMainListener) => handlers.set(channel, fn),
      } as unknown as IpcMain,
      router,
      userDataPath: directory,
      localDb: local,
      localDbPath: join(directory, 'local.db'),
      localProjectsDir,
      runtime: {} as AIRuntimeConfigService,
    });
    workspace.watchWindow(window as unknown as import('electron').BrowserWindow);
    json.mockClear();
    await workspace.initialize();
    expect(await call(CC.cloudStatus)).toMatchObject({ pending: false, pendingElsewhere: true });
    expect(json).not.toHaveBeenCalled();
    window.close();
    expect(window.isDestroyed()).toBe(false);
    expect(window.webContents.send).toHaveBeenCalledWith('cloud-close-requested', null);
    expect(workspace.hasOpenProjects).toBe(false);
    expect(await call(C.project.get, 1)).toMatchObject({ name: 'Local project' });
  });
});
