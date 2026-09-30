import {
  digest,
  HttpError,
  MAX_CLOUD_RESOURCES,
  MAX_PROJECTS,
  parseProjectManifestV2,
  parseResourceManifestV2,
  projectManifestHashesV2,
  readJson,
  requireId,
  requireInteger,
  requireResourceKind,
  requireString,
  resourceManifestHashesV2,
  type CloudProjectV2,
  type CloudResourceKind,
  type CloudResourceV2,
  type ProjectManifestV2,
  type ResourceManifestV2,
} from '@cat/cloud-contracts';
import { requireBlobHashes } from './blobs';
import type { Env } from './env';

type CatalogKind = 'project' | 'resource';
interface CatalogRow {
  id: string;
  name: string;
  revision: number;
  manifest: string;
  updated_at: number;
  kind?: CloudResourceKind;
  src_lang?: string;
  tgt_lang?: string;
}
interface OperationRow {
  revision: number;
  payload_hash: string;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

function requireBodyShape(body: Record<string, unknown>, fields: string[]): void {
  if (Object.keys(body).some((key) => !fields.includes(key)))
    throw new HttpError(400, 'Unsupported request field');
}

function catalogJson(row: CatalogRow, kind: CatalogKind): CloudProjectV2 | CloudResourceV2 {
  const common = {
    id: row.id,
    name: row.name,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
  return kind === 'project'
    ? { ...common, manifest: JSON.parse(row.manifest) as ProjectManifestV2 }
    : {
        ...common,
        kind: row.kind!,
        srcLang: row.src_lang!,
        tgtLang: row.tgt_lang!,
        manifest: JSON.parse(row.manifest) as ResourceManifestV2,
      };
}

async function requireProjectResources(
  env: Env,
  userId: string,
  manifest: ProjectManifestV2,
): Promise<void> {
  for (let offset = 0; offset < manifest.resources.length; offset += 80) {
    const references = manifest.resources.slice(offset, offset + 80);
    const rows = await env.DB.prepare(
      `SELECT id, kind FROM cloud_v2_resources WHERE owner_id = ? AND id IN (${references.map(() => '?').join(',')})`,
    )
      .bind(userId, ...references.map((reference) => reference.id))
      .all<{ id: string; kind: CloudResourceKind }>();
    const owned = new Map(rows.results.map((row) => [row.id, row.kind]));
    if (references.some((reference) => owned.get(reference.id) !== reference.kind))
      throw new HttpError(400, 'Project references an unavailable resource');
  }
}

async function requireContent(
  env: Env,
  userId: string,
  manifest: ProjectManifestV2 | ResourceManifestV2,
): Promise<void> {
  if ('state' in manifest) {
    await requireBlobHashes(env, userId, projectManifestHashesV2(manifest));
    await requireProjectResources(env, userId, manifest);
  } else {
    await requireBlobHashes(env, userId, resourceManifestHashesV2(manifest));
  }
}

// Table names come only from this closed discriminator, never from request data.
export async function handleCatalogV2(
  request: Request,
  env: Env,
  userId: string,
  path: string[],
  kind: CatalogKind,
): Promise<Response> {
  const table = kind === 'project' ? 'cloud_v2_projects' : 'cloud_v2_resources';
  const operations =
    kind === 'project' ? 'cloud_v2_project_operations' : 'cloud_v2_resource_operations';
  if (path.length > 2 || (path.length === 2 && path[1] !== 'commit'))
    throw new HttpError(404, 'Route not found');
  const id = path.length ? requireId(path[0]) : undefined;
  if (!id && request.method === 'GET') {
    const rows = await env.DB.prepare(
      `SELECT * FROM ${table} WHERE owner_id = ? ORDER BY updated_at DESC, id`,
    )
      .bind(userId)
      .all<CatalogRow>();
    return json(rows.results.map((row) => catalogJson(row, kind)));
  }
  if (!id && request.method === 'POST') {
    const body = await readJson(request);
    requireBodyShape(
      body,
      kind === 'project'
        ? ['id', 'name', 'manifest']
        : ['id', 'kind', 'name', 'srcLang', 'tgtLang', 'manifest'],
    );
    const entityId = requireId(body.id);
    const name = requireString(body.name, 'name');
    const manifest =
      kind === 'project'
        ? parseProjectManifestV2(body.manifest)
        : parseResourceManifestV2(body.manifest);
    await requireContent(env, userId, manifest);
    const serialized = JSON.stringify(manifest);
    let srcLang: string | undefined;
    let tgtLang: string | undefined;
    let resourceKind: CloudResourceKind | undefined;
    if (kind === 'resource') {
      resourceKind = requireResourceKind(body.kind);
      if (resourceKind !== (manifest as ResourceManifestV2).kind)
        throw new HttpError(400, 'Resource kind mismatch');
      srcLang = requireString(body.srcLang, 'source language', 64);
      tgtLang = requireString(body.tgtLang, 'target language', 64);
      await env.DB.prepare(
        `INSERT OR IGNORE INTO cloud_v2_resources(id, owner_id, kind, name, src_lang, tgt_lang, manifest, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, unixepoch()
         WHERE (SELECT COUNT(*) FROM cloud_v2_resources WHERE owner_id = ?) < ?`,
      )
        .bind(
          entityId,
          userId,
          resourceKind,
          name,
          srcLang,
          tgtLang,
          serialized,
          userId,
          MAX_CLOUD_RESOURCES,
        )
        .run();
    } else {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO cloud_v2_projects(id, owner_id, name, manifest, updated_at)
         SELECT ?, ?, ?, ?, unixepoch() WHERE
         (SELECT COUNT(*) FROM cloud_projects WHERE owner_id = ?) +
         (SELECT COUNT(*) FROM cloud_v2_projects WHERE owner_id = ?) < ?`,
      )
        .bind(entityId, userId, name, serialized, userId, userId, MAX_PROJECTS)
        .run();
    }
    const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ? AND owner_id = ?`)
      .bind(entityId, userId)
      .first<CatalogRow>();
    if (!row) throw new HttpError(409, 'Cloud quota reached or id unavailable');
    if (
      row.manifest !== serialized ||
      row.name !== name ||
      (kind === 'resource' &&
        (row.kind !== resourceKind || row.src_lang !== srcLang || row.tgt_lang !== tgtLang))
    )
      throw new HttpError(409, 'Cloud id already exists');
    return json(catalogJson(row, kind), 201);
  }
  if (!id) throw new HttpError(405, 'Method not allowed');
  const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ? AND owner_id = ?`)
    .bind(id, userId)
    .first<CatalogRow>();
  if (!row)
    throw new HttpError(404, kind === 'project' ? 'Project not found' : 'Resource not found');
  if (path.length === 1 && request.method === 'GET') return json(catalogJson(row, kind));
  if (path.length !== 2 || request.method !== 'POST')
    throw new HttpError(405, 'Method not allowed');
  const body = await readJson(request);
  requireBodyShape(body, ['revision', 'operationId', 'manifest', 'name']);
  const expected = requireInteger(body.revision);
  if (!expected) throw new HttpError(400, 'Invalid revision');
  const operation = requireId(body.operationId);
  const name = body.name === undefined ? undefined : requireString(body.name, 'name');
  const manifest =
    kind === 'project'
      ? parseProjectManifestV2(body.manifest)
      : parseResourceManifestV2(body.manifest);
  if (kind === 'resource' && row.kind !== (manifest as ResourceManifestV2).kind)
    throw new HttpError(400, 'Resource kind mismatch');
  const payloadHash = await digest(
    new TextEncoder().encode(JSON.stringify({ expected, manifest, name })),
  );
  const getOperation = () =>
    env.DB.prepare(
      `SELECT revision, payload_hash FROM ${operations} WHERE entity_id = ? AND operation_id = ?`,
    )
      .bind(id, operation)
      .first<OperationRow>();
  const previous = await getOperation();
  if (previous) {
    if (previous.payload_hash !== payloadHash) throw new HttpError(409, 'Operation id reused');
    return json({ revision: previous.revision });
  }
  await requireContent(env, userId, manifest);
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE ${table} SET manifest = ?, name = COALESCE(?, name), revision = revision + 1,
       updated_at = unixepoch(), last_operation = ?
       WHERE id = ? AND owner_id = ? AND revision = ? AND NOT EXISTS
       (SELECT 1 FROM ${operations} WHERE entity_id = ? AND operation_id = ?)`,
    ).bind(JSON.stringify(manifest), name ?? null, operation, id, userId, expected, id, operation),
    env.DB.prepare(
      `INSERT OR IGNORE INTO ${operations}(entity_id, operation_id, payload_hash, revision)
       SELECT id, ?, ?, revision FROM ${table}
       WHERE id = ? AND owner_id = ? AND last_operation = ? AND revision = ?`,
    ).bind(operation, payloadHash, id, userId, operation, expected + 1),
  ]);
  if (!results[0].meta.changes) {
    const retry = await getOperation();
    if (retry?.payload_hash === payloadHash) return json({ revision: retry.revision });
    throw new HttpError(409, 'A newer cloud version exists. Local changes have not been uploaded.');
  }
  return json({ revision: expected + 1 });
}

export function handleProjectsV2(
  request: Request,
  env: Env,
  userId: string,
  path: string[],
): Promise<Response> {
  return handleCatalogV2(request, env, userId, path, 'project');
}

export function handleResourcesV2(
  request: Request,
  env: Env,
  userId: string,
  path: string[],
): Promise<Response> {
  return handleCatalogV2(request, env, userId, path, 'resource');
}
