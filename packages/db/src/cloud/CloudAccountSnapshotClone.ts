import { randomUUID } from 'node:crypto';
import type {
  CloudSnapshotAfterRestore,
  ProjectSnapshotV2,
  ResourceSnapshotV2,
} from './CloudAccountSnapshotFormat';
import {
  open,
  exportProject,
  exportResource,
  exportCloudAccountProject,
  exportCloudResource,
  restoreCloudResource,
  restoreResource,
  restoreProject,
  finishRestore,
} from './CloudAccountSnapshotStorage';
import { validateProject, validateResource } from './CloudAccountSnapshotValidation';

function cloneResource(snapshot: ResourceSnapshotV2): ResourceSnapshotV2 {
  const copy = structuredClone(snapshot);
  copy.resource.id = randomUUID();
  for (const entry of copy.entries) {
    entry.id = randomUUID();
    if ('tmId' in entry) {
      entry.tmId = copy.resource.id;
      entry.originSegmentId = null;
    } else entry.tbId = copy.resource.id;
  }
  return copy;
}
export function cloneLocalCloudResource(
  sourceDbPath: string,
  targetDbPath: string,
  kind: 'tm' | 'tb',
  id: string,
): string {
  return restoreCloudResource(
    targetDbPath,
    cloneResource(exportCloudResource(sourceDbPath, kind, id)),
  );
}

/** Copy a project and all its resources with independent transport identities. */
export function cloneCloudProject(
  sourceDbPath: string,
  targetDbPath: string,
  projectId: number,
  options: { uuid?: string; name?: string } = {},
  afterRestore?: CloudSnapshotAfterRestore,
): number {
  const source = open(sourceDbPath, true);
  let project: ProjectSnapshotV2;
  let resources: ResourceSnapshotV2[];
  try {
    [project, resources] = source.transaction(() => {
      const snapshot = exportProject(source, projectId);
      const shared = [
        ...snapshot.mounts.tms
          .filter((mount) => mount.tmId !== snapshot.workingTM?.resource.id)
          .map((mount) => exportResource(source, 'tm', mount.tmId)),
        ...snapshot.mounts.tbs.map((mount) => exportResource(source, 'tb', mount.tbId)),
      ];
      return [snapshot, shared] as const;
    })();
  } finally {
    source.close();
  }
  project.project.uuid = options.uuid ?? randomUUID();
  project.project.name = options.name ?? project.project.name;
  const fileIds = new Map(project.files.map((file) => [file.uuid, randomUUID()]));
  const segmentIds = new Map(project.segments.map((segment) => [segment.segmentId, randomUUID()]));
  for (const file of project.files) file.uuid = fileIds.get(file.uuid)!;
  for (const segment of project.segments) {
    segment.segmentId = segmentIds.get(segment.segmentId)!;
    segment.fileUUID = fileIds.get(segment.fileUUID)!;
    if (segment.qaIssuesJson) {
      const issues = JSON.parse(segment.qaIssuesJson) as { references?: { segmentId: string }[] }[];
      for (const issue of issues)
        for (const reference of issue.references ?? []) {
          reference.segmentId = segmentIds.get(reference.segmentId) ?? reference.segmentId;
        }
      segment.qaIssuesJson = JSON.stringify(issues);
    }
  }
  if (project.workingTM) {
    const previousId = project.workingTM.resource.id;
    project.workingTM.resource.id = randomUUID();
    for (const entry of project.workingTM.entries) {
      entry.id = randomUUID();
      entry.tmId = project.workingTM.resource.id;
      entry.originSegmentId = entry.originSegmentId
        ? (segmentIds.get(entry.originSegmentId) ?? null)
        : null;
    }
    for (const mount of project.mounts.tms)
      if (mount.tmId === previousId) mount.tmId = project.workingTM.resource.id;
  }
  const copies = resources.map((resource) => {
    const copy = cloneResource(resource);
    if (copy.kind === 'tm')
      for (const mount of project.mounts.tms) {
        if (mount.tmId === resource.resource.id) mount.tmId = copy.resource.id;
      }
    else
      for (const mount of project.mounts.tbs) {
        if (mount.tbId === resource.resource.id) mount.tbId = copy.resource.id;
      }
    return copy;
  });
  validateProject(project);
  for (const resource of copies) validateResource(resource);
  const target = open(targetDbPath);
  try {
    return target.transaction(() => {
      if (target.prepare('SELECT 1 FROM projects WHERE uuid = ?').get(project.project.uuid))
        throw new Error('Cloned project identity already exists');
      for (const resource of copies) restoreResource(target, resource);
      return finishRestore(
        target,
        restoreProject(target, project),
        afterRestore,
        new Map(Array.from(fileIds, ([sourceUUID, uuid]) => [uuid, sourceUUID])),
      );
    })();
  } finally {
    target.close();
  }
}

/** Preserve a conflicted cloud project as an independent local project. */
export function cloneCloudProjectAsLocal(
  sourceDbPath: string,
  targetDbPath: string,
  projectId: number,
  afterRestore?: CloudSnapshotAfterRestore,
): number {
  const source = exportCloudAccountProject(sourceDbPath, projectId);
  return cloneCloudProject(
    sourceDbPath,
    targetDbPath,
    projectId,
    { name: `${source.project.name} (local copy)` },
    afterRestore,
  );
}
