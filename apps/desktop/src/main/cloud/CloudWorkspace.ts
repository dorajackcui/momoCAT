import { BrowserWindow, type IpcMain } from 'electron';
import { join } from 'node:path';
import { mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CATDatabase, cloneCloudProjectAsLocal, cloneLocalCloudResource } from '@cat/db';
import type { AIRuntimeConfigService } from '@cat/localization';
import type { CloudProject, CloudProjectV2 } from '@cat/cloud-contracts';
import { CLOUD_CHANNELS, type CloudResourceKind, type CloudSyncResult } from '../../shared/cloud';
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
import { internalProjectFilePath } from '../services/modules/projectFileStorage';
import { CloudConnection, CloudRequestError } from './CloudConnection';
import { migrateLegacyCloudProject } from './CloudLegacyMigration';
import { CloudAccountSession } from './CloudAccountSession';
import { IpcContextRouter } from './IpcContextRouter';
import { cloudReads, cloudWrites } from './cloudPolicy';

interface WindowSession {
  account: CloudAccountSession;
  projectId?: number;
  resourceKind?: CloudResourceKind;
  window: BrowserWindow;
  assertIdle: () => void;
  dispose: () => Promise<void>;
  notify: (event: ReferenceDataChangedEvent) => void;
  busy: boolean;
}
interface Dependencies {
  ipcMain: IpcMain;
  router: IpcContextRouter;
  userDataPath: string;
  localDb: CATDatabase;
  localDbPath?: string;
  localProjectsDir?: string;
  runtime: AIRuntimeConfigService;
  localJobs?: JobManager;
  onCloseCancelled?: () => void;
  windowTitle?: string;
}
const EXPERIMENT_CLOUD_URL = 'https://momocat-cloud-v1.dorajackcui.workers.dev';

export class CloudWorkspace {
  private readonly connection: CloudConnection;
  private readonly windows = new Map<number, WindowSession>();
  private readonly opening = new Set<number>();
  private readonly localRunning = new Set<string>();
  private account?: CloudAccountSession;
  private accountOpening?: Promise<CloudAccountSession>;
  constructor(private readonly deps: Dependencies) {
    deps.localJobs?.on('progress', (job) => {
      if (job.status === 'running') this.localRunning.add(job.jobId);
      else this.localRunning.delete(job.jobId);
    });
    this.connection = new CloudConnection(
      process.env.MOMOCAT_CLOUD_URL ?? EXPERIMENT_CLOUD_URL,
      join(deps.userDataPath, 'cloud', 'session.json'),
    );
  }
  hasWindow(id: number): boolean {
    return this.windows.has(id);
  }
  get hasOpenProjects(): boolean {
    return this.windows.size > 0;
  }
  private requireEntry(id: number): WindowSession {
    const entry = this.windows.get(id);
    if (!entry) throw new Error('Open a cloud project or cloud resources first');
    return entry;
  }
  private window(event: { sender: { id: number } }): BrowserWindow {
    const window = BrowserWindow.fromWebContents(event.sender as Electron.WebContents);
    if (!window) throw new Error('Workspace window unavailable');
    return window;
  }
  private kind(input: unknown): CloudResourceKind {
    if (input !== 'tm' && input !== 'tb') throw new Error('Invalid resource type');
    return input;
  }
  private id(input: unknown): string {
    if (typeof input !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input))
      throw new Error('Invalid cloud id');
    return input;
  }
  async initialize(): Promise<void> {
    const ipc = this.deps.ipcMain;
    ipc.handle(CLOUD_CHANNELS.cloudStatus, (event) => {
      const entry = this.windows.get(event.sender.id);
      return {
        configured: !!this.connection.baseURL,
        configurationError: this.connection.configurationError,
        account: this.connection.account,
        ...(entry
          ? {
              context: 'cloud',
              resourceKind: entry.resourceKind,
              ...entry.account.status(entry.projectId),
            }
          : {}),
      };
    });
    ipc.handle('cloud-cancel-close', () => this.deps.onCloseCancelled?.());
    ipc.handle(CLOUD_CHANNELS.cloudStartLogin, () => {
      this.assertAccountChange();
      return this.connection.startLogin();
    });
    ipc.handle(CLOUD_CHANNELS.cloudPollLogin, () => this.connection.pollLogin());
    ipc.handle(CLOUD_CHANNELS.cloudLogout, async () => {
      this.assertAccountChange();
      await this.connection.logout();
      this.account?.dispose();
      this.account = undefined;
    });
    ipc.handle(CLOUD_CHANNELS.cloudListProjects, () => this.listProjects());
    ipc.handle(CLOUD_CHANNELS.cloudCreateProject, (_event, ...args: unknown[]) =>
      this.createProject(args),
    );
    ipc.handle(CLOUD_CHANNELS.cloudOpenProject, (event, id: unknown) =>
      this.openProject(this.window(event), this.id(id)),
    );
    ipc.handle(CLOUD_CHANNELS.cloudOpenResources, (event, kind: unknown) =>
      this.openResources(this.window(event), this.kind(kind)),
    );
    ipc.handle(CLOUD_CHANNELS.cloudSync, (event, allProjects: unknown) => {
      if (allProjects !== undefined && typeof allProjects !== 'boolean')
        throw new Error('Invalid synchronization scope');
      return this.synchronize(this.requireEntry(event.sender.id), allProjects === true);
    });
    ipc.handle(CLOUD_CHANNELS.cloudPull, async (event) => {
      const entry = this.requireEntry(event.sender.id);
      if (entry.account.hasPending(entry.projectId))
        throw new Error('Local changes must be preserved before getting the cloud version');
      await this.synchronize(entry);
      return entry.projectId;
    });
    const leave = async (
      event: { sender: { id: number } },
      keepLocal: unknown,
      closeWindow: unknown,
    ) => {
      const entry = this.windows.get(event.sender.id);
      if (!entry) return;
      entry.assertIdle();
      if (entry.account.hasPending(entry.projectId, true) && keepLocal !== true)
        throw new Error('Confirm keeping changes on this device first');
      await entry.dispose();
      if (closeWindow === true)
        setTimeout(() => {
          if (!entry.window.isDestroyed()) entry.window.close();
        }, 0);
    };
    ipc.handle(CLOUD_CHANNELS.cloudCloseProject, leave);
    ipc.handle(CLOUD_CHANNELS.cloudLeaveContext, leave);
    ipc.handle(CLOUD_CHANNELS.cloudListLocalResources, (_event, kind: unknown) => {
      const type = this.kind(kind);
      return type === 'tm' ? this.deps.localDb.listTMs('main') : this.deps.localDb.listTermBases();
    });
    ipc.handle(CLOUD_CHANNELS.cloudCopyResource, async (event, kind: unknown, id: unknown) => {
      const entry = this.requireEntry(event.sender.id);
      this.assertAccountIdle();
      if (this.localRunning.size) throw new Error('Wait for local operations to finish');
      const type = this.kind(kind);
      const copied = entry.account.copyResource(this.localDbPath, type, this.id(id));
      return type === 'tm' ? entry.account.db.getTM(copied) : entry.account.db.getTermBase(copied);
    });
    ipc.handle(CLOUD_CHANNELS.cloudResolveConflict, (event) =>
      this.resolveConflict(this.requireEntry(event.sender.id)),
    );
    await this.connection.initialize();
  }
  private get localDbPath(): string {
    return this.deps.localDbPath ?? join(this.deps.userDataPath, 'cat_v1.db');
  }
  private get localProjectsDir(): string {
    return this.deps.localProjectsDir ?? join(this.deps.userDataPath, 'projects');
  }
  private assertAccountChange(): void {
    if (this.hasOpenProjects || this.opening.size || this.accountOpening)
      throw new Error('Leave cloud projects before changing accounts');
  }
  private assertAccountIdle(): void {
    if (this.opening.size) throw new Error('Wait for the cloud context to open');
    for (const entry of this.windows.values()) entry.assertIdle();
    this.account?.assertWritable();
  }
  private async getAccount(): Promise<CloudAccountSession> {
    if (!this.connection.account || !this.connection.baseURL) throw new Error('Sign in first');
    if (this.account) return this.account;
    if (this.accountOpening) return this.accountOpening;
    const directory = join(
      this.deps.userDataPath,
      'cloud',
      createHash('sha256').update(this.connection.baseURL).digest('hex').slice(0, 16),
      this.id(this.connection.account.id),
      'account-v2',
    );
    this.accountOpening = (async () => {
      const account = new CloudAccountSession(directory, this.connection);
      await account.initialize();
      this.account = account;
      return account;
    })();
    try {
      return await this.accountOpening;
    } finally {
      this.accountOpening = undefined;
    }
  }
  private async listProjects() {
    const account = await this.getAccount();
    const drafts = account.db.listProjects().map((project) => ({
      id: project.uuid,
      name: project.name,
      revision: account.tracker.ensure('project', project.uuid).revision,
    }));
    try {
      const [current, legacy] = await Promise.all([
        this.connection.json<CloudProjectV2[]>('/v2/projects'),
        this.connection.json<CloudProject[]>('/v1/projects'),
      ]);
      const remote = [
        ...current,
        ...legacy.filter((project) => !current.some((other) => other.id === project.id)),
      ];
      return [
        ...remote,
        ...drafts.filter((project) => !remote.some((other) => other.id === project.id)),
      ];
    } catch (error) {
      if (drafts.length) return drafts;
      throw error;
    }
  }
  private async createProject(args: unknown[]) {
    const [name, src, tgt, type] = args;
    if (
      ![name, src, tgt].every(
        (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 200,
      ) ||
      !isProjectType(type)
    )
      throw new Error('Invalid project details');
    this.assertAccountIdle();
    return (await this.getAccount()).createProject(
      String(name).trim(),
      String(src),
      String(tgt),
      type,
    );
  }
  private async switchContext(
    window: BrowserWindow,
    open: (
      account: CloudAccountSession,
    ) => Promise<{ projectId?: number; resourceKind?: CloudResourceKind }>,
  ) {
    const senderId = window.webContents.id;
    if (this.opening.has(senderId)) throw new Error('A cloud context is already opening');
    this.assertAccountIdle();
    if (
      !this.windows.has(senderId) &&
      (this.localRunning.size || this.deps.router.isBusy(senderId))
    )
      throw new Error('Wait for local operations to finish');
    this.opening.add(senderId);
    const previous = this.windows.get(senderId);
    if (previous) previous.busy = true;
    try {
      const account = await this.getAccount();
      const context = await open(account);
      if (previous) await previous.dispose();
      this.attach(window, account, context);
      return context;
    } finally {
      this.opening.delete(senderId);
      if (previous) previous.busy = false;
    }
  }
  private async openProject(window: BrowserWindow, id: string): Promise<number> {
    const context = await this.switchContext(window, async (account) => {
      try {
        return { projectId: await account.openProject(id) };
      } catch (error) {
        if (!(error instanceof CloudRequestError) || error.status !== 404) throw error;
        return { projectId: await migrateLegacyCloudProject(account, this.connection, id) };
      }
    });
    return context.projectId!;
  }
  private async openResources(window: BrowserWindow, kind: CloudResourceKind): Promise<void> {
    await this.switchContext(window, async (account) => {
      await account.openResources();
      return { resourceKind: kind };
    });
  }
  private invalidate(): void {
    for (const entry of this.windows.values())
      entry.notify({ projectId: entry.projectId ?? 0, kind: 'tm', reason: 'tm-imported' });
    for (const entry of this.windows.values())
      entry.notify({ projectId: entry.projectId ?? 0, kind: 'tb', reason: 'tb-imported' });
  }
  private async synchronize(entry: WindowSession, allProjects = false): Promise<CloudSyncResult> {
    this.assertAccountIdle();
    entry.busy = true;
    try {
      return await entry.account.synchronize(entry.projectId, allProjects);
    } finally {
      entry.busy = false;
      this.invalidate();
    }
  }
  private async resolveConflict(entry: WindowSession): Promise<CloudSyncResult> {
    this.assertAccountIdle();
    if (this.localRunning.size) throw new Error('Wait for local operations to finish');
    const conflicts = entry.account.getConflicts();
    if (!conflicts.length) throw new Error('Synchronize first to check for conflicts');
    let localCopyProjectId: number | undefined;
    let localCopyName: string | undefined;
    for (const row of conflicts) {
      if (row.kind === 'project') {
        const projectId = entry.account.projectId(row.id)!;
        const sourceFiles = entry.account.db.listFiles(projectId);
        const staged: string[] = [];
        try {
          localCopyProjectId = cloneCloudProjectAsLocal(
            entry.account.dbPath,
            this.localDbPath,
            projectId,
            (copyId, files) => {
              const destination = join(this.localProjectsDir, String(copyId));
              mkdirSync(destination, { recursive: true });
              staged.push(destination);
              files.forEach((file) => {
                const source = sourceFiles.find((original) => original.uuid === file.sourceUUID);
                if (!source) throw new Error('Original project file mapping is unavailable');
                copyFileSync(
                  internalProjectFilePath(entry.account.projectsDir, source),
                  internalProjectFilePath(this.localProjectsDir, file),
                );
              });
            },
          );
          localCopyName = this.deps.localDb.getProject(localCopyProjectId)?.name;
        } catch (error) {
          for (const directory of staged) rmSync(directory, { recursive: true, force: true });
          throw error;
        }
      } else {
        const id = cloneLocalCloudResource(
          entry.account.dbPath,
          this.localDbPath,
          row.kind,
          row.id,
        );
        localCopyName = (
          row.kind === 'tm' ? this.deps.localDb.getTM(id) : this.deps.localDb.getTermBase(id)
        )?.name;
      }
    }
    entry.busy = true;
    try {
      await entry.account.acceptCloud(conflicts);
      return { projectId: entry.projectId, changed: true, localCopyProjectId, localCopyName };
    } finally {
      entry.busy = false;
      this.invalidate();
    }
  }
  private attach(
    window: BrowserWindow,
    account: CloudAccountSession,
    context: { projectId?: number; resourceKind?: CloudResourceKind },
  ): void {
    const senderId = window.webContents.id;
    const jobs = new JobManager();
    const running = new Set<string>();
    jobs.on('progress', (event) => {
      if (event.status === 'running') running.add(event.jobId);
      else running.delete(event.jobId);
    });
    const send = (channel: string, data: unknown) => {
      if (!window.isDestroyed()) window.webContents.send(channel, data);
    };
    const ipc = this.deps.router.bind(senderId, (channel) => {
      if (entry.busy || account.busy || this.opening.size)
        throw new Error('Wait for synchronization to finish');
      if (cloudWrites.has(channel)) account.assertWritable();
      else if (!cloudReads.has(channel))
        throw new Error('This action is unavailable in cloud projects');
    });
    const service = new ProjectService(account.db, account.projectsDir, account.dbPath, {
      aiRuntimeConfigProvider: this.deps.runtime,
      settingsRepo: new SqliteSettingsRepository(this.deps.localDb),
    });
    const lookup = new ReferenceLookupWorkerManager({ dbPath: account.dbPath });
    const prefetch = new ReferenceLookupWorkerManager({ dbPath: account.dbPath });
    const notify = (event: ReferenceDataChangedEvent) => {
      void lookup.invalidateReferenceData().catch(() => {});
      void prefetch.invalidateReferenceData().catch(() => {});
      send(IPC_CHANNELS.events.referenceDataChanged, event);
    };
    const referenceDeps = {
      ipcMain: ipc,
      projectService: service,
      jobManager: jobs,
      referenceLookup: lookup,
      referenceLookupPrefetch: prefetch,
      notifyReferenceDataChanged: (event: ReferenceDataChangedEvent) => {
        for (const other of this.windows.values()) other.notify(event);
      },
    };
    const unsubscribe = subscribeToWorkingTMReferenceDataChanges(
      service,
      referenceDeps.notifyReferenceDataChanged,
    );
    registerProjectHandlers({ ipcMain: ipc, projectService: service });
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
      account,
      ...context,
      window,
      busy: false,
      notify,
      assertIdle: () => {
        if (entry.busy || account.busy || running.size || this.deps.router.isBusy(senderId))
          throw new Error('Wait for active operations to finish');
      },
      dispose: async () => {
        entry.busy = true;
        await lookup.dispose();
        await prefetch.dispose();
        unsubscribe();
        unsubscribeQA();
        this.deps.router.remove(senderId);
        this.windows.delete(senderId);
        window.removeListener('close', onClose);
        window.setTitle(this.deps.windowTitle ?? 'momoCAT');
      },
    };
    this.windows.set(senderId, entry);
    window.on('close', onClose);
  }
  async dispose(): Promise<void> {
    for (const entry of [...this.windows.values()]) await entry.dispose();
    this.account?.dispose();
    this.account = undefined;
  }
}
