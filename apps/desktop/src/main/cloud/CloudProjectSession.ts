import { CATDatabase, CloudSnapshotOutbox, restoreCloudProject } from '@cat/db';
import {
  MAX_BLOB_BYTES,
  parseManifest,
  type CloudProject,
  type Manifest,
} from '@cat/cloud-contracts';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { CloudConnection, cloudChunkHashes } from './CloudConnection';
import { internalProjectFilePath } from '../services/modules/projectFileStorage';

interface CacheInfo {
  revision: number;
  projectId: number;
  manifest: Manifest;
}
interface PendingSnapshot {
  operationId: string;
  revision: number;
  state: unknown;
  resources?: unknown;
  files?: Manifest['files'];
}

// Each device edits an isolated local database. Only sync() publishes a version;
// neither opening, closing nor an elapsed timer uploads project data.
export class CloudProjectSession {
  readonly dbPath: string;
  readonly projectsDir: string;
  db!: CATDatabase;
  projectId!: number;
  private outbox!: CloudSnapshotOutbox;
  private revision = 0;
  private manifest!: Manifest;
  private syncing?: Promise<void>;
  private disposed = false;
  error?: string;

  constructor(
    readonly remote: CloudProject,
    private readonly connection: CloudConnection,
    readonly directory: string,
  ) {
    this.dbPath = join(directory, 'cat_v1.db');
    this.projectsDir = join(directory, 'projects');
  }

  private async saveInfo(): Promise<void> {
    await writeFile(
      join(this.directory, 'cache.json.tmp'),
      JSON.stringify({
        revision: this.revision,
        projectId: this.projectId,
        manifest: this.manifest,
      }),
    );
    await rename(join(this.directory, 'cache.json.tmp'), join(this.directory, 'cache.json'));
  }

  async open(): Promise<void> {
    let cache: CacheInfo | undefined;
    try {
      cache = JSON.parse(await readFile(join(this.directory, 'cache.json'), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await mkdir(this.directory, { recursive: true });
    if (cache) {
      // Never implicitly replace a device's work, even when the cloud is newer.
      this.manifest = parseManifest(cache.manifest);
      this.projectId = cache.projectId;
      this.revision = cache.revision;
    } else {
      this.manifest = parseManifest(this.remote.manifest);
      const state = JSON.parse(
        (await this.connection.download(this.manifest.state)).toString('utf8'),
      );
      const resources = JSON.parse(
        (await this.connection.download(this.manifest.resources)).toString('utf8'),
      );
      const temporary = `${this.dbPath}.download-${randomUUID()}`;
      this.projectId = restoreCloudProject(temporary, state, resources);
      await rename(temporary, this.dbPath);
      this.revision = this.remote.revision;
    }
    this.db = new CATDatabase(this.dbPath);
    this.outbox = new CloudSnapshotOutbox(this.dbPath, this.projectId);
    if (!cache) {
      const files = this.db.listFiles(this.projectId);
      if (
        files.length !== this.manifest.files.length ||
        files.some((f) => !this.manifest.files.some((a) => a.id === f.id))
      )
        throw new Error('Cloud file manifest mismatch');
      await mkdir(join(this.projectsDir, String(this.projectId)), { recursive: true });
      for (const file of files) {
        const path = internalProjectFilePath(this.projectsDir, file);
        await writeFile(
          `${path}.download`,
          await this.connection.download(this.manifest.files.find((f) => f.id === file.id)!.chunks),
        );
        await rename(`${path}.download`, path);
      }
      // Publish cache metadata only after the full project has been restored.
      await this.saveInfo();
    }
    if (this.remote.revision > this.revision)
      this.error =
        'A newer cloud version is available. Get latest before continuing on this device.';
  }

  get writable(): boolean {
    return !this.disposed && !this.syncing;
  }
  assertWritable(): void {
    if (!this.writable) throw new Error('Wait for the cloud operation to finish');
  }
  status() {
    const state = this.outbox.status();
    return {
      id: this.remote.id,
      projectId: this.projectId,
      name: this.db.getProject(this.projectId)?.name ?? this.remote.name,
      revision: this.revision,
      pending: !!state.pending || state.generation !== state.confirmed,
      writable: this.writable,
      error: this.error,
    };
  }

  private prepare(): PendingSnapshot | null {
    const pending = this.outbox.prepare(randomUUID(), this.revision, (rows) => {
      // Capture original bytes before any await. Retrying an upload must still
      // work after the source file has been renamed or removed from the project.
      const blobsDir = join(this.directory, 'outbox-blobs');
      mkdirSync(blobsDir, { recursive: true });
      return rows.map((file) => {
        const data = readFileSync(
          internalProjectFilePath(this.projectsDir, {
            id: Number(file.id),
            projectId: this.projectId,
            name: String(file.name),
          }),
        );
        const chunks = cloudChunkHashes(data);
        chunks.forEach((hash, index) =>
          writeFileSync(
            join(blobsDir, hash),
            data.subarray(index * MAX_BLOB_BYTES, (index + 1) * MAX_BLOB_BYTES),
          ),
        );
        return { id: Number(file.id), chunks };
      });
    });
    return pending ? (JSON.parse(pending) as PendingSnapshot) : null;
  }

  sync(): Promise<void> {
    if (this.syncing) return this.syncing;
    const run = async () => {
      try {
        for (let attempts = 0; attempts < 20; attempts++) {
          const saved = this.prepare();
          if (!saved) return;
          const state = await this.connection.upload(Buffer.from(JSON.stringify(saved.state)));
          // Existing prototype outboxes contain only state; retain their resource
          // manifest when retrying. New captures always include the whole project.
          const resources = saved.resources
            ? await this.connection.upload(Buffer.from(JSON.stringify(saved.resources)))
            : this.manifest.resources;
          const files = saved.files ?? this.manifest.files;
          for (const hash of new Set((saved.files ?? []).flatMap((f) => f.chunks))) {
            const bytes = await readFile(join(this.directory, 'outbox-blobs', hash));
            if (cloudChunkHashes(bytes)[0] !== hash)
              throw new Error('Local upload cache is damaged');
            await this.connection.upload(bytes);
          }
          const manifest = parseManifest({ ...this.manifest, state, resources, files });
          const committed = await this.connection.json<{ revision: number }>(
            `/v1/projects/${this.remote.id}/commit`,
            'POST',
            {
              mode: 'relay',
              revision: saved.revision,
              operationId: saved.operationId,
              manifest,
            },
          );
          this.revision = committed.revision;
          this.manifest = manifest;
          await this.saveInfo();
          this.outbox.acknowledge(saved.operationId);
          this.error = undefined;
          if (!this.status().pending) return;
        }
        throw new Error('Project is still changing; wait for active work to finish and save again');
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Cloud save failed';
        throw error;
      }
    };
    // Defer capture until the busy flag is visible to every IPC mutation.
    this.syncing = Promise.resolve()
      .then(run)
      .finally(() => {
        this.syncing = undefined;
      });
    return this.syncing;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.outbox?.close();
    this.db?.close();
  }
}
