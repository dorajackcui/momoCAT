export const PROTOCOL_VERSION = 1;
export const MAX_BLOB_BYTES = 4 * 1024 * 1024;
export const MAX_ACCOUNT_BYTES = 64 * 1024 * 1024;
export const MAX_PROJECTS = 10;

export interface Manifest {
  protocol: 1;
  schema: 15;
  // Ordered chunks of a UTF-8 JSON document; hashes name private immutable blobs.
  state: string[];
  resources: string[];
  files: Array<{ id: number; chunks: string[] }>;
}

export interface CloudProject {
  id: string;
  name: string;
  revision: number;
  manifest: Manifest;
  updatedAt: number;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function requireString(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new HttpError(400, `Invalid ${label}`);
  return value;
}

export function requireId(value: unknown): string {
  const id = requireString(value, 'id', 64);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new HttpError(400, 'Invalid id');
  return id;
}

export function requireInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new HttpError(400, 'Invalid revision');
  return value as number;
}

export function parseManifest(value: unknown): Manifest {
  const data = value as Manifest;
  const hashes = (v: unknown): v is string[] =>
    Array.isArray(v) &&
    v.length <= 128 &&
    v.every((h) => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h));
  if (
    !data ||
    data.protocol !== 1 ||
    data.schema !== 15 ||
    !hashes(data.state) ||
    !data.state.length ||
    !hashes(data.resources) ||
    !data.resources.length ||
    !Array.isArray(data.files) ||
    data.files.length > 100 ||
    !data.files.every((f) => f && Number.isSafeInteger(f.id) && f.id > 0 && hashes(f.chunks)) ||
    new Set(data.files.map((f) => f.id)).size !== data.files.length
  )
    throw new HttpError(400, 'Unsupported project manifest');
  const result: Manifest = {
    protocol: 1,
    schema: 15,
    state: data.state,
    resources: data.resources,
    files: data.files.map((f) => ({ id: f.id, chunks: f.chunks })),
  };
  if (manifestHashes(result).length > 256) throw new HttpError(413, 'Project is too large');
  return result;
}

export function manifestHashes(manifest: Manifest): string[] {
  return [
    ...new Set([
      ...manifest.state,
      ...manifest.resources,
      ...manifest.files.flatMap((f) => f.chunks),
    ]),
  ];
}

export async function readBytes(request: Request, max: number): Promise<Uint8Array> {
  if (!request.body) throw new HttpError(400, 'Missing body');
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new HttpError(413, 'Request too large');
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(new TextDecoder().decode(await readBytes(request, 64 * 1024)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Invalid JSON body');
  }
}

export async function digest(bytes: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
