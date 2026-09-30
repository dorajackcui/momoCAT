import { HttpError, requireId } from './index';

export const PROTOCOL_VERSION_V2 = 2;
export const MAX_CLOUD_RESOURCES = 100;

export type CloudResourceKind = 'tm' | 'tb';

export interface ProjectManifestV2 {
  protocol: 2;
  schema: 15;
  state: string[];
  files: Array<{ id: string; chunks: string[] }>;
  resources: Array<{ id: string; kind: CloudResourceKind }>;
}

export interface ResourceManifestV2 {
  protocol: 2;
  schema: 15;
  kind: CloudResourceKind;
  data: string[];
}

export interface CloudProjectV2 {
  id: string;
  name: string;
  revision: number;
  manifest: ProjectManifestV2;
  updatedAt: number;
}

export interface CloudResourceV2 {
  id: string;
  kind: CloudResourceKind;
  name: string;
  srcLang: string;
  tgtLang: string;
  revision: number;
  manifest: ResourceManifestV2;
  updatedAt: number;
}

function shape(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new HttpError(400, `Unsupported ${label}`);
  return value as Record<string, unknown>;
}

function hashes(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 128 ||
    value.some((hash) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))
  )
    throw new HttpError(400, 'Invalid blob chunks');
  return [...value];
}

export function requireResourceKind(value: unknown): CloudResourceKind {
  if (value !== 'tm' && value !== 'tb') throw new HttpError(400, 'Invalid resource kind');
  return value;
}

export function projectManifestHashesV2(manifest: ProjectManifestV2): string[] {
  return [...new Set([...manifest.state, ...manifest.files.flatMap((file) => file.chunks)])];
}

export function resourceManifestHashesV2(manifest: ResourceManifestV2): string[] {
  return [...new Set(manifest.data)];
}

export function parseProjectManifestV2(value: unknown): ProjectManifestV2 {
  const data = shape(
    value,
    ['protocol', 'schema', 'state', 'files', 'resources'],
    'project manifest',
  );
  if (
    data.protocol !== 2 ||
    data.schema !== 15 ||
    !Array.isArray(data.files) ||
    data.files.length > 100 ||
    !Array.isArray(data.resources) ||
    data.resources.length > MAX_CLOUD_RESOURCES
  )
    throw new HttpError(400, 'Unsupported project manifest');
  const state = hashes(data.state);
  if (!state.length) throw new HttpError(400, 'Missing project state');
  const files = data.files.map((value) => {
    const file = shape(value, ['id', 'chunks'], 'file manifest');
    return { id: requireId(file.id), chunks: hashes(file.chunks) };
  });
  const resources = data.resources.map((value) => {
    const resource = shape(value, ['id', 'kind'], 'resource reference');
    return { id: requireId(resource.id), kind: requireResourceKind(resource.kind) };
  });
  if (
    new Set(files.map((file) => file.id)).size !== files.length ||
    new Set(resources.map((resource) => resource.id)).size !== resources.length
  )
    throw new HttpError(400, 'Duplicate manifest identity');
  const manifest: ProjectManifestV2 = { protocol: 2, schema: 15, state, files, resources };
  if (projectManifestHashesV2(manifest).length > 256)
    throw new HttpError(413, 'Project is too large');
  return manifest;
}

export function parseResourceManifestV2(value: unknown): ResourceManifestV2 {
  const resource = shape(value, ['protocol', 'schema', 'kind', 'data'], 'resource manifest');
  if (resource.protocol !== 2 || resource.schema !== 15)
    throw new HttpError(400, 'Unsupported resource manifest');
  const kind = requireResourceKind(resource.kind);
  const data = hashes(resource.data);
  if (!data.length) throw new HttpError(400, 'Missing resource data');
  return { protocol: 2, schema: 15, kind, data };
}
