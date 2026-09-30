import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import {
  CATDatabase,
  exportCloudAccountProject,
  exportCloudResource,
  restoreCloudAccountProject,
  restoreCloudResource,
  type CloudObjectKind,
  type ProjectSnapshotV2,
  type ResourceSnapshotV2,
} from '@cat/db';
import {
  MAX_BLOB_BYTES,
  parseProjectManifestV2,
  parseResourceManifestV2,
  type CloudProjectV2,
  type CloudResourceV2,
  type ProjectManifestV2,
  type ResourceManifestV2,
} from '@cat/cloud-contracts';
import { CloudConnection, cloudChunkHashes } from './CloudConnection';
import { internalProjectFilePath } from '../services/modules/projectFileStorage';
import { CloudProjectInstallations } from './CloudProjectInstallations';

export interface CapturedCloudObject {
  kind: CloudObjectKind;
  id: string;
  name: string;
  srcLang: string;
  tgtLang: string;
  snapshot: ProjectSnapshotV2 | ResourceSnapshotV2;
  files: ProjectManifestV2['files'];
  signature: string;
}
export interface PendingCloudObject extends CapturedCloudObject {
  revision: number;
  operationId: string;
  generation: number;
}

function signature(
  snapshot: CapturedCloudObject['snapshot'],
  files: ProjectManifestV2['files'],
): string {
  // SQL rowids are device-local, so transport order must not cause false edits.
  const stable = structuredClone(snapshot);
  if (stable.kind === 'project') {
    stable.files.sort((a, b) => a.uuid.localeCompare(b.uuid));
    stable.segments.sort((a, b) => a.segmentId.localeCompare(b.segmentId));
    stable.prompts.sort((a, b) => a.name.localeCompare(b.name));
    stable.mounts.tms.sort((a, b) => a.tmId.localeCompare(b.tmId));
    stable.mounts.tbs.sort((a, b) => a.tbId.localeCompare(b.tbId));
    stable.workingTM?.entries.sort((a, b) => a.id.localeCompare(b.id));
  } else stable.entries.sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256')
    .update(
      JSON.stringify({
        snapshot: stable,
        files: [...files].sort((a, b) => a.id.localeCompare(b.id)),
      }),
    )
    .digest('hex');
}

export class CloudSnapshotTransfer {
  private readonly blobsDir: string;
  private readonly installations: CloudProjectInstallations;
  constructor(
    private readonly db: CATDatabase,
    private readonly dbPath: string,
    private readonly projectsDir: string,
    directory: string,
    private readonly connection: CloudConnection,
    private readonly onProjectInstalled?: () => void,
  ) {
    this.blobsDir = join(directory, 'outbox-blobs');
    this.installations = new CloudProjectInstallations(db, dbPath, projectsDir, directory);
  }

  recover(): void {
    this.installations.recover();
  }

  capture(kind: CloudObjectKind, id: string, retainFiles = false): CapturedCloudObject {
    const project =
      kind === 'project' ? this.db.listProjects().find((p) => p.uuid === id) : undefined;
    if (kind === 'project' && !project) throw new Error('Cloud project not found in this cache');
    const snapshot = project
      ? exportCloudAccountProject(this.dbPath, project.id)
      : exportCloudResource(this.dbPath, kind as 'tm' | 'tb', id);
    const metadata = snapshot.kind === 'project' ? snapshot.project : snapshot.resource;
    const files: ProjectManifestV2['files'] = [];
    if (project) {
      if (retainFiles) mkdirSync(this.blobsDir, { recursive: true });
      for (const file of this.db.listFiles(project.id)) {
        const bytes = readFileSync(internalProjectFilePath(this.projectsDir, file));
        const chunks = cloudChunkHashes(bytes);
        if (retainFiles)
          chunks.forEach((hash, index) =>
            writeFileSync(
              join(this.blobsDir, hash),
              bytes.subarray(index * MAX_BLOB_BYTES, (index + 1) * MAX_BLOB_BYTES),
            ),
          );
        files.push({ id: file.uuid, chunks });
      }
    }
    return {
      kind,
      id,
      name: metadata.name,
      srcLang: metadata.srcLang,
      tgtLang: metadata.tgtLang,
      snapshot,
      files,
      signature: signature(snapshot, files),
    };
  }

  async publish(pending: PendingCloudObject): Promise<number> {
    const chunks = await this.connection.upload(Buffer.from(JSON.stringify(pending.snapshot)));
    let manifest: ProjectManifestV2 | ResourceManifestV2;
    if (pending.snapshot.kind === 'project') {
      const snapshot = pending.snapshot;
      const resources: ProjectManifestV2['resources'] = [
        ...snapshot.mounts.tms
          .filter((m) => m.tmId !== snapshot.workingTM?.resource.id)
          .map((m) => ({ id: m.tmId, kind: 'tm' as const })),
        ...snapshot.mounts.tbs.map((m) => ({ id: m.tbId, kind: 'tb' as const })),
      ];
      manifest = { protocol: 2, schema: 15, state: chunks, files: pending.files, resources };
      for (const hash of new Set(pending.files.flatMap((file) => file.chunks))) {
        const bytes = readFileSync(join(this.blobsDir, hash));
        if (cloudChunkHashes(bytes)[0] !== hash) throw new Error('Local upload cache is damaged');
        await this.connection.upload(bytes);
      }
    } else manifest = { protocol: 2, schema: 15, kind: pending.snapshot.kind, data: chunks };
    const route = pending.kind === 'project' ? '/v2/projects' : '/v2/resources';
    if (pending.revision === 0) {
      const result = await this.connection.json<{ revision: number }>(route, 'POST', {
        id: pending.id,
        name: pending.name,
        manifest,
        ...(pending.kind === 'project'
          ? {}
          : { kind: pending.kind, srcLang: pending.srcLang, tgtLang: pending.tgtLang }),
      });
      return result.revision;
    }
    const result = await this.connection.json<{ revision: number }>(
      `${route}/${pending.id}/commit`,
      'POST',
      {
        revision: pending.revision,
        operationId: pending.operationId,
        name: pending.name,
        manifest,
      },
    );
    return result.revision;
  }

  async receiveResource(remote: CloudResourceV2): Promise<void> {
    const manifest = parseResourceManifestV2(remote.manifest);
    const snapshot = JSON.parse(
      (await this.connection.download(manifest.data)).toString('utf8'),
    ) as ResourceSnapshotV2;
    if (
      snapshot.kind !== remote.kind ||
      snapshot.resource.id !== remote.id ||
      snapshot.resource.name !== remote.name ||
      snapshot.resource.srcLang !== remote.srcLang ||
      snapshot.resource.tgtLang !== remote.tgtLang
    )
      throw new Error('Cloud resource identity mismatch');
    restoreCloudResource(this.dbPath, snapshot);
  }

  async receiveProject(remote: CloudProjectV2): Promise<number> {
    const manifest = parseProjectManifestV2(remote.manifest);
    const snapshot = JSON.parse(
      (await this.connection.download(manifest.state)).toString('utf8'),
    ) as ProjectSnapshotV2;
    if (
      snapshot.kind !== 'project' ||
      snapshot.project.uuid !== remote.id ||
      snapshot.project.name !== remote.name
    )
      throw new Error('Cloud project identity mismatch');
    const expected = [
      ...snapshot.mounts.tms
        .filter((m) => m.tmId !== snapshot.workingTM?.resource.id)
        .map((m) => `tm:${m.tmId}`),
      ...snapshot.mounts.tbs.map((m) => `tb:${m.tbId}`),
    ].sort();
    if (
      JSON.stringify(expected) !==
        JSON.stringify(manifest.resources.map((r) => `${r.kind}:${r.id}`).sort()) ||
      JSON.stringify(snapshot.files.map((f) => f.uuid).sort()) !==
        JSON.stringify(manifest.files.map((f) => f.id).sort())
    )
      throw new Error('Cloud project manifest mismatch');
    this.installations.initialize();
    const installationId = randomUUID();
    const staging = this.installations.staging(installationId);
    const digest = signature(snapshot, manifest.files);
    await mkdir(staging, { recursive: true });
    try {
      for (const file of manifest.files)
        await writeFile(join(staging, file.id), await this.connection.download(file.chunks));
      const id = restoreCloudAccountProject(this.dbPath, snapshot, (projectId, files) => {
        for (const file of files)
          renameSync(join(staging, file.uuid), join(staging, `${file.id}_${file.name}`));
        return this.installations.install(
          installationId,
          projectId,
          remote.id,
          remote.revision,
          digest,
        );
      });
      this.onProjectInstalled?.();
      this.installations.complete(installationId);
      return id;
    } catch (error) {
      // SQL rollback has no receipt; SQL commit has a receipt. The same recovery
      // path is safe after either outcome, including restart after a crash.
      try {
        this.installations.complete(installationId);
      } catch {
        /* Retain journal for restart. */
      }
      throw error;
    } finally {
      // A prepared install has already moved staging or retains it in its
      // journal; an interrupted download has not moved any installed bytes.
      await rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }
}
