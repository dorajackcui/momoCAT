import { BrowserWindow, type IpcMain } from 'electron';
import { join } from 'node:path';
import { mkdtemp, mkdir, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { CATDatabase, exportCloudProject } from '@cat/db';
import type { AIRuntimeConfigService } from '@cat/localization';
import type { CloudProject } from '@cat/cloud-contracts';
import { CLOUD_CHANNELS } from '../../shared/cloud';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { ReferenceDataChangedEvent } from '../../shared/ipc';
import type { IpcMainLike } from '../ipc/types';
import { isProjectType } from '../ipc/projectPayloadValidation';
import { ProjectService } from '../services/ProjectService';
import { SqliteSettingsRepository } from '../services/adapters/SqliteSettingsRepository';
import { JobManager } from '../JobManager';
import { ReferenceLookupWorkerManager } from '../services/referenceLookup/ReferenceLookupWorkerManager';
import { registerProjectHandlers } from '../ipc/projectHandlers';
import { registerTMHandlers } from '../ipc/tmHandlers';
import { registerTBHandlers } from '../ipc/tbHandlers';
import { registerAIHandlers } from '../ipc/aiHandlers';
import { registerJobHandlers } from '../ipc/jobHandlers';
import { subscribeToWorkingTMReferenceDataChanges } from '../referenceDataInvalidation';
import { CloudConnection } from './CloudConnection';
import { CloudProjectSession } from './CloudProjectSession';
import { IpcContextRouter } from './IpcContextRouter';
import { cloudReads, cloudWrites } from './cloudPolicy';

interface WindowSession {
  session: CloudProjectSession;
  window: BrowserWindow;
  assertIdle: () => void;
  dispose: () => Promise<void>;
  busy: boolean;
}
interface Dependencies {
  ipcMain: IpcMain;
  router: IpcContextRouter;
  userDataPath: string;
  localDb: CATDatabase;
  runtime: AIRuntimeConfigService;
  localJobs?: JobManager;
}

export class CloudWorkspace {
  private readonly connection: CloudConnection;
  private readonly windows = new Map<number, WindowSession>();
  private readonly opening = new Set<number>();
  private readonly localRunning = new Set<string>();
  constructor(private readonly deps: Dependencies) {
    deps.localJobs?.on('progress', (job) => {
      if (job.status === 'running') this.localRunning.add(job.jobId);
      else this.localRunning.delete(job.jobId);
    });
    this.connection = new CloudConnection(
      process.env.MOMOCAT_CLOUD_URL,
      join(deps.userDataPath, 'cloud', 'session.json'),
    );
  }
  hasWindow(id: number): boolean {
    return this.windows.has(id);
  }
  get hasOpenProjects(): boolean {
    return this.windows.size > 0;
  }

  async initialize(): Promise<void> {
    const { ipcMain } = this.deps;
    ipcMain.handle(CLOUD_CHANNELS.cloudStatus, (event) => ({
      configured: !!this.connection.baseURL,
      configurationError: this.connection.configurationError,
      account: this.connection.account,
      project: this.windows.get(event.sender.id)?.session.status(),
    }));
    ipcMain.handle(CLOUD_CHANNELS.cloudStartLogin, () => {
      if (this.hasOpenProjects || this.opening.size)
        throw new Error('Close cloud projects before changing accounts');
      return this.connection.startLogin();
    });
    ipcMain.handle(CLOUD_CHANNELS.cloudPollLogin, () => this.connection.pollLogin());
    ipcMain.handle(CLOUD_CHANNELS.cloudLogout, () => {
      if (this.hasOpenProjects || this.opening.size)
        throw new Error('Close cloud projects before signing out');
      return this.connection.logout();
    });
    ipcMain.handle(CLOUD_CHANNELS.cloudListProjects, () => this.connection.json('/v1/projects'));
    ipcMain.handle(CLOUD_CHANNELS.cloudCreateProject, (_event, ...args: unknown[]) =>
      this.createProject(args),
    );
    ipcMain.handle(CLOUD_CHANNELS.cloudOpenProject, (event, id: unknown, keepLocal: unknown) => {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id))
        throw new Error('Invalid project id');
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) throw new Error('Workspace window unavailable');
      return this.openProject(window, id, keepLocal === true);
    });
    ipcMain.handle(CLOUD_CHANNELS.cloudSync, async (event) => {
      const entry = this.requireSession(event.sender.id);
      entry.assertIdle();
      await entry.session.sync();
    });
    ipcMain.handle(CLOUD_CHANNELS.cloudPull, (event) =>
      this.pull(this.requireSession(event.sender.id)),
    );
    ipcMain.handle(
      CLOUD_CHANNELS.cloudCloseProject,
      async (event, keepLocal: unknown, closeWindow: unknown) => {
        const entry = this.windows.get(event.sender.id);
        if (!entry) return;
        entry.assertIdle();
        if (entry.session.status().pending && keepLocal !== true)
          throw new Error('Save to cloud or confirm keeping changes on this device before closing');
        await entry.dispose();
        if (closeWindow === true) entry.window.close();
      },
    );
    await this.connection.initialize();
  }

  private requireSession(id: number): WindowSession {
    const entry = this.windows.get(id);
    if (!entry) throw new Error('Open a cloud project first');
    return entry;
  }
  private cacheDirectory(id: string): string {
    const account = this.connection.account;
    if (!account || !/^[a-zA-Z0-9_-]+$/.test(account.id)) throw new Error('Sign in first');
    return join(
      this.deps.userDataPath,
      'cloud',
      createHash('sha256').update(this.connection.baseURL!).digest('hex').slice(0, 16),
      account.id,
      id,
    );
  }

  private async createProject(args: unknown[]): Promise<CloudProject> {
    if (!this.connection.account) throw new Error('Sign in first');
    const [name, src, tgt, type] = args;
    if (
      ![name, src, tgt].every(
        (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 200,
      ) ||
      !isProjectType(type)
    )
      throw new Error('Invalid project details');
    const stagingRoot = join(this.deps.userDataPath, 'cloud', 'staging');
    await mkdir(stagingRoot, { recursive: true });
    const directory = await mkdtemp(join(stagingRoot, 'create-'));
    try {
      const path = join(directory, 'cat_v1.db');
      const db = new CATDatabase(path);
      let projectId: number;
      try {
        projectId = db.createProject(String(name).trim(), String(src), String(tgt), type);
      } finally {
        db.close();
      }
      const snapshot = exportCloudProject(path, projectId);
      const state = await this.connection.upload(Buffer.from(JSON.stringify(snapshot.state)));
      const resources = await this.connection.upload(
        Buffer.from(JSON.stringify(snapshot.resources)),
      );
      return await this.connection.json<CloudProject>('/v1/projects', 'POST', {
        mode: 'relay',
        id: randomUUID(),
        name: String(name).trim(),
        manifest: { protocol: 1, schema: 15, state, resources, files: [] },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async openProject(
    window: BrowserWindow,
    id: string,
    keepLocal: boolean,
  ): Promise<number> {
    const senderId = window.webContents.id;
    if (this.opening.has(senderId)) throw new Error('A project is already opening');
    const previous = this.windows.get(senderId);
    if (!previous && (this.localRunning.size || this.deps.router.isBusy(senderId)))
      throw new Error('Wait for active local operations to finish before opening a cloud project');
    if (previous?.session.remote.id === id) return previous.session.projectId;
    if (previous) {
      previous.assertIdle();
      if (previous.session.status().pending && !keepLocal)
        throw new Error('Confirm keeping changes on this device first');
    }
    if ([...this.windows.values()].some((w) => w.session.remote.id === id))
      throw new Error('This cloud project is already open in another window');
    this.opening.add(senderId);
    if (previous) previous.busy = true;
    let session: CloudProjectSession | undefined;
    try {
      const remote = await this.connection.json<CloudProject>(`/v1/projects/${id}`);
      session = new CloudProjectSession(remote, this.connection, this.cacheDirectory(id));
      await session.open();
      if (previous) await previous.dispose();
      this.attach(window, session);
      return session.projectId;
    } catch (error) {
      session?.dispose();
      throw error;
    } finally {
      this.opening.delete(senderId);
      if (previous) previous.busy = false;
    }
  }

  private async pull(entry: WindowSession): Promise<number> {
    entry.assertIdle();
    if (entry.session.status().pending)
      throw new Error(
        'This device has changes not saved to cloud. Keep them here; a newer version cannot replace them.',
      );
    entry.busy = true;
    const directory = entry.session.directory;
    const staging = `${directory}.download-${randomUUID()}`;
    const backup = `${directory}.previous-${randomUUID()}`;
    let replacement: CloudProjectSession | undefined;
    let detached = false;
    let archived = false;
    let installed = false;
    try {
      const remote = await this.connection.json<CloudProject>(
        `/v1/projects/${entry.session.remote.id}`,
      );
      if (remote.revision === entry.session.status().revision) return entry.session.projectId;
      replacement = new CloudProjectSession(remote, this.connection, staging);
      await replacement.open();
      replacement.dispose();
      await entry.dispose();
      detached = true;
      await rename(directory, backup);
      archived = true;
      await rename(staging, directory);
      installed = true;
      replacement = new CloudProjectSession(remote, this.connection, directory);
      await replacement.open();
      this.attach(entry.window, replacement);
      return replacement.projectId;
    } catch (error) {
      replacement?.dispose();
      if (detached) {
        if (installed) await rename(directory, staging);
        if (archived) await rename(backup, directory);
        const restored = new CloudProjectSession(entry.session.remote, this.connection, directory);
        await restored.open();
        this.attach(entry.window, restored);
      }
      throw error;
    } finally {
      entry.busy = false;
      await rm(staging, { recursive: true, force: true });
    }
  }

  private attach(window: BrowserWindow, session: CloudProjectSession): void {
    const senderId = window.webContents.id;
    const jobs = new JobManager();
    const running = new Set<string>();
    jobs.on('progress', (p) => {
      if (p.status === 'running') running.add(p.jobId);
      else running.delete(p.jobId);
    });
    const send = (channel: string, data: unknown) => {
      if (!window.isDestroyed()) window.webContents.send(channel, data);
    };
    const ipc: IpcMainLike = this.deps.router.bind(senderId, (channel) => {
      if (entry.busy) throw new Error('Wait for the cloud operation to finish');
      if (cloudWrites.has(channel)) session.assertWritable();
      else if (!cloudReads.has(channel))
        throw new Error('This action is unavailable inside a cloud project');
    });
    const service = new ProjectService(session.db, session.projectsDir, session.dbPath, {
      aiRuntimeConfigProvider: this.deps.runtime,
      settingsRepo: new SqliteSettingsRepository(this.deps.localDb),
    });
    const lookup = new ReferenceLookupWorkerManager({ dbPath: session.dbPath });
    const prefetch = new ReferenceLookupWorkerManager({ dbPath: session.dbPath });
    const referenceDeps = {
      ipcMain: ipc,
      projectService: service,
      jobManager: jobs,
      referenceLookup: lookup,
      referenceLookupPrefetch: prefetch,
      notifyReferenceDataChanged: (event: ReferenceDataChangedEvent) => {
        void lookup.invalidateReferenceData().catch(() => {});
        void prefetch.invalidateReferenceData().catch(() => {});
        send(IPC_CHANNELS.events.referenceDataChanged, event);
      },
    };
    const unsubscribe = subscribeToWorkingTMReferenceDataChanges(
      service,
      referenceDeps.notifyReferenceDataChanged,
    );
    registerProjectHandlers({ ipcMain: ipc, projectService: service });
    // The sidebar always keeps the device's local project catalog.
    ipc.handle(IPC_CHANNELS.project.list, () => this.deps.localDb.listProjects());
    registerTMHandlers(referenceDeps);
    registerTBHandlers(referenceDeps);
    registerAIHandlers({ ipcMain: ipc, projectService: service, jobManager: jobs });
    registerJobHandlers({ ipcMain: ipc, jobManager: jobs });
    service.onSegmentsUpdated((event) => send(IPC_CHANNELS.events.segmentsUpdatedBatch, [event]));
    service.onProgress((event) => send(IPC_CHANNELS.events.appProgress, event));
    const unsubscribeQA = service.onQAInvalidated((id) =>
      send(IPC_CHANNELS.events.qaInvalidated, id),
    );
    jobs.on('progress', (event) => send(IPC_CHANNELS.events.jobProgress, event));
    const onClose = (event: { preventDefault: () => void }) => {
      event.preventDefault();
      send('cloud-close-requested', null);
    };
    const entry: WindowSession = {
      session,
      window,
      busy: false,
      assertIdle: () => {
        if (entry.busy || !session.writable || running.size || this.deps.router.isBusy(senderId))
          throw new Error(
            'Wait for the active operation to finish before saving or switching projects',
          );
      },
      dispose: async () => {
        entry.busy = true;
        await lookup.dispose();
        await prefetch.dispose();
        unsubscribe();
        unsubscribeQA();
        session.dispose();
        this.deps.router.remove(senderId);
        this.windows.delete(senderId);
        window.removeListener('close', onClose);
        window.setTitle('momoCAT');
      },
    };
    this.windows.set(senderId, entry);
    window.setTitle(`momoCAT · ${session.remote.name}`);
    window.on('close', onClose);
  }
}
