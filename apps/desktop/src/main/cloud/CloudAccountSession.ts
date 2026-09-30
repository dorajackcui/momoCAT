import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import {
  CATDatabase,
  CloudAccountTracker,
  cloneLocalCloudResource,
  type CloudObjectKind,
  type CloudTrackedObject,
} from '@cat/db';
import type { CloudProjectV2, CloudResourceV2 } from '@cat/cloud-contracts';
import type { ProjectType } from '@cat/core/project';
import { CloudConnection, CloudRequestError } from './CloudConnection';
import { CloudSnapshotTransfer, type PendingCloudObject } from './CloudSnapshotTransfer';

export class CloudAccountSession {
  readonly dbPath: string;
  readonly projectsDir: string;
  db!: CATDatabase;
  tracker!: CloudAccountTracker;
  private transfer!: CloudSnapshotTransfer;
  busy = false;
  error?: string;
  conflict = false;
  lastSyncedAt?: string;
  cacheRevision = 0;
  private conflicts: CloudTrackedObject[] = [];
  constructor(
    readonly directory: string,
    private readonly connection: CloudConnection,
  ) {
    this.dbPath = join(directory, 'cat_v1.db');
    this.projectsDir = join(directory, 'projects');
  }
  async initialize(): Promise<void> {
    await mkdir(this.projectsDir, { recursive: true });
    this.db = new CATDatabase(this.dbPath);
    this.tracker = new CloudAccountTracker(this.dbPath);
    this.transfer = new CloudSnapshotTransfer(
      this.db,
      this.dbPath,
      this.projectsDir,
      this.directory,
      this.connection,
      () => {
        this.cacheRevision++;
      },
    );
    this.transfer.recover();
    this.lastSyncedAt =
      this.tracker
        .list()
        .map((row) => row.lastSyncedAt ?? '')
        .sort()
        .at(-1) || undefined;
  }
  projectId(id: string): number | undefined {
    return this.db.listProjects().find((p) => p.uuid === id)?.id;
  }
  private dirty(row: CloudTrackedObject): boolean {
    return !!row.pending || row.generation !== row.confirmed;
  }
  hasPending(projectId?: number, allProjects = false): boolean {
    const uuid = projectId === undefined ? undefined : this.db.getProject(projectId)?.uuid;
    return this.tracker
      .list()
      .some((row) => this.dirty(row) && (allProjects || row.kind !== 'project' || row.id === uuid));
  }
  assertWritable(): void {
    if (this.busy) throw new Error('Wait for synchronization to finish');
  }
  status(projectId?: number) {
    const project = projectId === undefined ? undefined : this.db.getProject(projectId);
    const row = project ? this.tracker.ensure('project', project.uuid) : undefined;
    return {
      pending: this.hasPending(projectId),
      pendingElsewhere: this.hasPending(projectId, true) && !this.hasPending(projectId),
      syncing: this.busy,
      lastSyncedAt: this.lastSyncedAt,
      cacheRevision: this.cacheRevision,
      error: this.error,
      conflict: this.conflict,
      project: project
        ? {
            id: project.uuid,
            projectId: project.id,
            name: project.name,
            revision: row!.revision,
            pending: this.hasPending(projectId),
            writable: !this.busy,
            syncing: this.busy,
            lastSyncedAt: this.lastSyncedAt,
            error: this.error,
            conflict: this.conflict,
          }
        : undefined,
    };
  }
  private acknowledge(
    kind: CloudObjectKind,
    id: string,
    revision: number,
    generation?: number,
    signature?: string,
  ) {
    const digest = signature ?? this.transfer.capture(kind, id).signature;
    this.tracker.acknowledge(kind, id, revision, digest, generation);
  }
  async createProject(
    name: string,
    src: string,
    tgt: string,
    type: ProjectType,
  ): Promise<CloudProjectV2> {
    this.assertWritable();
    const projectId = this.db.createProject(name, src, tgt, type);
    const id = this.db.getProject(projectId)!.uuid;
    // A failed creation remains a durable local cloud draft and can be retried.
    await this.synchronize(projectId);
    return this.connection.json<CloudProjectV2>(`/v2/projects/${id}`);
  }
  private async ensureResource(remote: CloudResourceV2): Promise<void> {
    const exists = remote.kind === 'tm' ? this.db.getTM(remote.id) : this.db.getTermBase(remote.id);
    if (exists) return;
    await this.receiveResource(remote);
    this.acknowledge(remote.kind, remote.id, remote.revision);
  }
  private async receiveResource(remote: CloudResourceV2): Promise<void> {
    const cleanProjects = this.tracker
      .list()
      .filter((row) => row.kind === 'project' && !this.dirty(row));
    await this.transfer.receiveResource(remote);
    this.cacheRevision++;
    // TB restoration invalidates derived QA in every mounted project. This is
    // part of receiving the cloud resource, not a new edit on this device.
    // Keep pre-existing drafts and durable pending operations untouched.
    for (const before of cleanProjects) {
      const after = this.tracker.get('project', before.id)!;
      if (after.generation !== before.generation)
        this.acknowledge('project', before.id, before.revision);
    }
  }
  async openProject(id: string): Promise<number> {
    this.assertWritable();
    const localId = this.projectId(id);
    if (localId !== undefined) return localId;
    const remote = await this.connection.json<CloudProjectV2>(`/v2/projects/${id}`);
    for (const reference of remote.manifest.resources) {
      const resource = await this.connection.json<CloudResourceV2>(`/v2/resources/${reference.id}`);
      if (resource.kind !== reference.kind) throw new Error('Cloud resource type mismatch');
      await this.ensureResource(resource);
    }
    const projectId = await this.transfer.receiveProject(remote);
    return projectId;
  }
  async openResources(): Promise<void> {
    this.assertWritable();
    const catalog = await this.connection.json<CloudResourceV2[]>('/v2/resources');
    for (const resource of catalog) await this.ensureResource(resource);
  }
  copyResource(sourceDbPath: string, kind: 'tm' | 'tb', id: string): string {
    this.assertWritable();
    return cloneLocalCloudResource(sourceDbPath, this.dbPath, kind, id);
  }
  private objects(
    projectId?: number,
    allProjects = false,
  ): Array<{ kind: CloudObjectKind; id: string }> {
    const result: Array<{ kind: CloudObjectKind; id: string }> = [
      ...this.db.listTMs('main').map((resource) => ({ kind: 'tm' as const, id: resource.id })),
      ...this.db.listTermBases().map((resource) => ({ kind: 'tb' as const, id: resource.id })),
    ];
    if (allProjects)
      result.push(
        ...this.db
          .listProjects()
          .map((project) => ({ kind: 'project' as const, id: project.uuid })),
      );
    else if (projectId !== undefined) {
      const project = this.db.getProject(projectId);
      if (!project) throw new Error('Cloud project not found');
      result.push({ kind: 'project', id: project.uuid });
    }
    return result;
  }
  private pending(row: CloudTrackedObject): PendingCloudObject {
    if (row.pending) return JSON.parse(row.pending) as PendingCloudObject;
    const capture = this.transfer.capture(row.kind, row.id, true);
    const pending: PendingCloudObject = {
      ...capture,
      generation: row.generation,
      revision: row.revision,
      operationId: randomUUID(),
    };
    this.tracker.prepare(row.kind, row.id, JSON.stringify(pending));
    return pending;
  }
  private async publish(row: CloudTrackedObject): Promise<void> {
    const pending = this.pending(row);
    const revision = await this.transfer.publish(pending);
    this.acknowledge(row.kind, row.id, revision, pending.generation, pending.signature);
  }
  private async receive(
    remote: CloudProjectV2 | CloudResourceV2,
    kind: CloudObjectKind,
  ): Promise<void> {
    if (kind === 'project') {
      const project = remote as CloudProjectV2;
      for (const reference of project.manifest.resources) {
        const resource = await this.connection.json<CloudResourceV2>(
          `/v2/resources/${reference.id}`,
        );
        if (resource.kind !== reference.kind) throw new Error('Cloud resource type mismatch');
        await this.ensureResource(resource);
      }
      await this.transfer.receiveProject(project);
    } else await this.receiveResource(remote as CloudResourceV2);
    if (kind !== 'project') this.acknowledge(kind, remote.id, remote.revision);
  }
  async synchronize(
    projectId?: number,
    allProjects = false,
  ): Promise<{ projectId?: number; changed: boolean }> {
    this.assertWritable();
    this.busy = true;
    this.error = undefined;
    this.conflict = false;
    this.conflicts = [];
    let changed = false;
    try {
      const [resources, projects] = await Promise.all([
        this.connection.json<CloudResourceV2[]>('/v2/resources'),
        this.connection.json<CloudProjectV2[]>('/v2/projects'),
      ]);
      const catalog = new Map<string, CloudProjectV2 | CloudResourceV2>([
        ...resources.map((r) => [`${r.kind}:${r.id}`, r] as const),
        ...projects.map((p) => [`project:${p.id}`, p] as const),
      ]);
      if (allProjects) {
        for (const resource of resources) {
          const before = this.cacheRevision;
          await this.ensureResource(resource);
          if (this.cacheRevision !== before) changed = true;
        }
      }
      for (const object of this.objects(projectId, allProjects)) {
        let row = this.tracker.ensure(object.kind, object.id);
        // Retry the exact durable operation first, including an acknowledged
        // server write whose response was lost. Never recapture its payload.
        if (row.pending) {
          try {
            await this.publish(row);
          } catch (error) {
            if (error instanceof CloudRequestError && error.status === 409)
              this.conflicts.push(row);
            else throw error;
          }
          if (this.conflicts.some((r) => r.kind === row.kind && r.id === row.id)) continue;
          row = this.tracker.get(row.kind, row.id)!;
          const route = row.kind === 'project' ? 'projects' : 'resources';
          catalog.set(
            `${row.kind}:${row.id}`,
            await this.connection.json(`/v2/${route}/${row.id}`),
          );
        }
        const remote = catalog.get(`${row.kind}:${row.id}`);
        if (!remote) {
          await this.publish(row);
          continue;
        }
        let dirty = this.dirty(row);
        if (dirty && this.transfer.capture(row.kind, row.id).signature === row.signature) {
          this.acknowledge(row.kind, row.id, row.revision);
          row = this.tracker.get(row.kind, row.id)!;
          dirty = false;
        }
        if (remote.revision !== row.revision && dirty) {
          this.conflicts.push(row);
          continue;
        }
        if (remote.revision !== row.revision) {
          await this.receive(remote, row.kind);
          changed = true;
        } else if (dirty) {
          try {
            await this.publish(row);
          } catch (error) {
            if (error instanceof CloudRequestError && error.status === 409)
              this.conflicts.push(row);
            else throw error;
          }
        }
      }
      if (this.conflicts.length) {
        this.conflict = true;
        throw new Error(
          'This device and the cloud both have changes. Your local work is preserved.',
        );
      }
      this.lastSyncedAt = new Date().toISOString();
      return { projectId, changed };
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Synchronization failed';
      throw error;
    } finally {
      this.busy = false;
    }
  }
  getConflicts(): CloudTrackedObject[] {
    return [...this.conflicts];
  }
  async acceptCloud(conflicts: CloudTrackedObject[]): Promise<void> {
    this.assertWritable();
    this.busy = true;
    try {
      for (const row of [...conflicts].sort(
        (a, b) => Number(a.kind === 'project') - Number(b.kind === 'project'),
      )) {
        const route = row.kind === 'project' ? 'projects' : 'resources';
        const remote = await this.connection.json<CloudProjectV2 | CloudResourceV2>(
          `/v2/${route}/${row.id}`,
        );
        await this.receive(remote, row.kind);
      }
      this.conflicts = [];
      this.conflict = false;
      this.error = undefined;
      this.lastSyncedAt = new Date().toISOString();
    } finally {
      this.busy = false;
    }
  }
  dispose(): void {
    this.tracker.close();
    this.db.close();
  }
}
