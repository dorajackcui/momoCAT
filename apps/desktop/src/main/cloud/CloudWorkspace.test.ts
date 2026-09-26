import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMain } from 'electron';
import { CATDatabase, exportCloudProject } from '@cat/db';
import type { AIRuntimeConfigService } from '@cat/localization';
import type { CloudProject } from '@cat/cloud-contracts';
import type { IpcMainListener } from '../ipc/types';
import { IPC_CHANNELS as C } from '../../shared/ipcChannels';
import { CLOUD_CHANNELS as CC } from '../../shared/cloud';
import { IpcContextRouter } from './IpcContextRouter';
import { CloudWorkspace } from './CloudWorkspace';
import { cloudChunkHashes } from './CloudConnection';
import { cloudReads, cloudWrites } from './cloudPolicy';

const harness = vi.hoisted(() => ({
  connection: {} as Record<string, unknown>,
  window: {} as unknown,
}));
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => harness.window },
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
  webContents = { id: 42, send: vi.fn() };
  setTitle = vi.fn();
  isDestroyed = () => false;
  close = vi.fn();
}

describe('manual relay workspace context', () => {
  let directory: string;
  let local: CATDatabase;
  let workspace: CloudWorkspace;
  let handlers: Map<string, IpcMainListener>;
  let remote: CloudProject;
  let blobs: Map<string, Buffer>;
  let json: ReturnType<typeof vi.fn>;
  const call = (channel: string, ...args: unknown[]) =>
    Promise.resolve().then(() => handlers.get(channel)!({ sender: { id: 42 } }, ...args));
  const store = (value: unknown) => {
    const bytes = Buffer.from(JSON.stringify(value));
    const hashes = cloudChunkHashes(bytes);
    blobs.set(hashes[0], bytes);
    return hashes;
  };
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'momocat-workspace-'));
    local = new CATDatabase(join(directory, 'local.db'));
    local.createProject('Local project', 'en', 'zh');
    const seedPath = join(directory, 'remote.db');
    const seed = new CATDatabase(seedPath);
    const id = seed.createProject('Cloud project', 'en', 'zh');
    seed.close();
    blobs = new Map();
    const snapshot = exportCloudProject(seedPath, id);
    remote = {
      id: 'remote',
      name: 'Cloud project',
      revision: 1,
      updatedAt: 1,
      manifest: {
        protocol: 1,
        schema: 15,
        state: store(snapshot.state),
        resources: store(snapshot.resources),
        files: [],
      },
    };
    json = vi.fn(async (path: string, method?: string, body?: Record<string, unknown>) => {
      if (path.endsWith('/commit')) {
        remote = {
          ...remote,
          revision: remote.revision + 1,
          manifest: body!.manifest as CloudProject['manifest'],
        };
        return { revision: remote.revision };
      }
      if (path === '/v1/projects' && method === 'POST') return { ...body, revision: 1 };
      return structuredClone(remote);
    });
    harness.connection = {
      baseURL: 'https://cloud.example',
      account: { id: 'alice', name: 'Alice', email: 'a@example.test' },
      initialize: vi.fn(),
      json,
      upload: async (bytes: Uint8Array) => {
        const hashes = cloudChunkHashes(bytes);
        blobs.set(hashes[0], Buffer.from(bytes));
        return hashes;
      },
      download: async (hashes: string[]) => Buffer.concat(hashes.map((h) => blobs.get(h)!)),
    };
    harness.window = new TestWindow();
    handlers = new Map();
    const ipc = {
      handle: (channel: string, fn: IpcMainListener) => {
        handlers.set(channel, fn);
      },
    };
    const router = new IpcContextRouter(ipc);
    for (const channel of new Set([...cloudReads, ...cloudWrites]))
      router.local.handle(channel, () => 'local');
    router.local.handle(C.project.get, () => local.getProject(1));
    workspace = new CloudWorkspace({
      ipcMain: ipc as IpcMain,
      router,
      userDataPath: directory,
      localDb: local,
      runtime: {} as AIRuntimeConfigService,
    });
    await workspace.initialize();
  });
  afterEach(async () => {
    if (workspace.hasOpenProjects) await call(CC.cloudCloseProject, true);
    local.close();
    rmSync(directory, { recursive: true, force: true });
  });
  it('switches the same window between equal local and cloud ids without mixing their data', async () => {
    expect(await call(CC.cloudOpenProject, 'remote')).toBe(1);
    expect(await call(C.project.get, 1)).toMatchObject({ name: 'Cloud project' });
    expect(await call(C.project.list)).toMatchObject([{ name: 'Local project' }]);
    await call(C.project.updatePrompt, 1, 'Cloud draft');
    expect(local.getProject(1)?.aiPrompt).not.toBe('Cloud draft');
    await expect(call(CC.cloudCloseProject)).rejects.toThrow('keeping changes');
    await expect(call(CC.cloudPull)).rejects.toThrow('changes not saved');
    await call(CC.cloudCloseProject, true);
    expect(await call(C.project.get, 1)).toMatchObject({ name: 'Local project' });
    expect(json.mock.calls.some(([route]) => route.endsWith('/commit'))).toBe(false);
    await call(CC.cloudOpenProject, 'remote');
    expect(await call(C.project.get, 1)).toMatchObject({ aiPrompt: 'Cloud draft' });
  });
  it('pulls explicitly and leaves the current cache usable when a download fails', async () => {
    await call(CC.cloudOpenProject, 'remote');
    const state = JSON.parse(blobs.get(remote.manifest.state[0])!.toString());
    state.tables.projects[0].aiPrompt = 'New remote content';
    remote.manifest.state = store(state);
    remote.revision = 2;
    expect(await call(C.project.get, 1)).not.toMatchObject({ aiPrompt: 'New remote content' });
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
  });
  it('creates directly in cloud without leaving a duplicate local project', async () => {
    await call(CC.cloudCreateProject, 'New cloud project', 'ja', 'en', 'review');
    expect(local.listProjects()).toHaveLength(1);
    expect(json).toHaveBeenCalledWith(
      '/v1/projects',
      'POST',
      expect.objectContaining({ name: 'New cloud project', mode: 'relay' }),
    );
  });
});
