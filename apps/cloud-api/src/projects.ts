import type { Env } from './env';
import { requireBlobs } from './blobs';
import {
  digest,
  HttpError,
  MAX_PROJECTS,
  parseManifest,
  readJson,
  requireId,
  requireInteger,
  requireString,
} from '@cat/cloud-contracts';

interface ProjectRow {
  id: string;
  name: string;
  revision: number;
  manifest: string;
  updated_at: number;
}

function projectJson(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    revision: row.revision,
    manifest: JSON.parse(row.manifest),
    updatedAt: row.updated_at,
  };
}

export async function handleProjects(
  request: Request,
  env: Env,
  userId: string,
  path: string[],
): Promise<Response> {
  const id = path[0] ? requireId(path[0]) : undefined;
  if (!id && request.method === 'GET') {
    const rows = await env.DB.prepare(
      'SELECT * FROM cloud_projects WHERE owner_id = ? ORDER BY updated_at DESC',
    )
      .bind(userId)
      .all<ProjectRow>();
    return Response.json(rows.results.map(projectJson));
  }
  if (!id && request.method === 'POST') {
    const body = await readJson(request);
    if (body.mode !== 'relay') throw new HttpError(426, 'Update momoCAT to use manual cloud relay');
    const projectId = requireId(body.id);
    const name = requireString(body.name, 'name');
    const manifest = parseManifest(body.manifest);
    await requireBlobs(env, userId, manifest);
    const serialized = JSON.stringify(manifest);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO cloud_projects(id, owner_id, name, manifest, updated_at)
      SELECT ?, ?, ?, ?, unixepoch() WHERE (SELECT COUNT(*) FROM cloud_projects WHERE owner_id = ?) < ?`,
    )
      .bind(projectId, userId, name, serialized, userId, MAX_PROJECTS)
      .run();
    const row = await env.DB.prepare('SELECT * FROM cloud_projects WHERE id = ? AND owner_id = ?')
      .bind(projectId, userId)
      .first<ProjectRow>();
    if (!row) throw new HttpError(409, 'Project quota reached or id unavailable');
    if (row.manifest !== serialized || row.name !== name)
      throw new HttpError(409, 'Project id already exists');
    return Response.json(projectJson(row), { status: 201 });
  }
  const row = await env.DB.prepare('SELECT * FROM cloud_projects WHERE id = ? AND owner_id = ?')
    .bind(id ?? '', userId)
    .first<ProjectRow>();
  if (!row) throw new HttpError(404, 'Project not found');
  if (path.length === 1 && request.method === 'GET') return Response.json(projectJson(row));
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  const body = await readJson(request);
  if (path[1] !== 'commit') throw new HttpError(404, 'Route not found');
  if (body.mode !== 'relay') throw new HttpError(426, 'Update momoCAT to use manual cloud relay');
  const expected = requireInteger(body.revision);
  const operation = requireId(body.operationId);
  const manifest = parseManifest(body.manifest);
  const serialized = JSON.stringify(manifest);
  const payloadHash = await digest(
    new TextEncoder().encode(JSON.stringify({ expected, manifest })),
  );
  const previous = await env.DB.prepare(
    'SELECT revision, payload_hash FROM cloud_operations WHERE project_id = ? AND operation_id = ?',
  )
    .bind(id!, operation)
    .first<{ revision: number; payload_hash: string }>();
  if (previous) {
    if (previous.payload_hash !== payloadHash) throw new HttpError(409, 'Operation id reused');
    return Response.json({ revision: previous.revision });
  }
  await requireBlobs(env, userId, manifest);
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE cloud_projects SET manifest = ?, revision = revision + 1, updated_at = unixepoch(), last_operation = ?
      WHERE id = ? AND owner_id = ? AND revision = ?`,
    ).bind(serialized, operation, id!, userId, expected),
    env.DB.prepare(
      `INSERT OR IGNORE INTO cloud_operations(project_id, operation_id, payload_hash, revision)
      SELECT id, ?, ?, revision FROM cloud_projects WHERE id = ? AND owner_id = ? AND last_operation = ? AND revision = ?`,
    ).bind(operation, payloadHash, id!, userId, operation, expected + 1),
  ]);
  if (!results[0].meta.changes) {
    const retry = await env.DB.prepare(
      'SELECT revision, payload_hash FROM cloud_operations WHERE project_id = ? AND operation_id = ?',
    )
      .bind(id!, operation)
      .first<{ revision: number; payload_hash: string }>();
    if (retry?.payload_hash === payloadHash) return Response.json({ revision: retry.revision });
    throw new HttpError(409, 'A newer cloud version exists. Local changes have not been uploaded.');
  }
  return Response.json({ revision: expected + 1 });
}
