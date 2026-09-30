import type { Env } from './env';
import { D1BlobStore } from './D1BlobStore';
import {
  digest,
  HttpError,
  manifestHashes,
  MAX_ACCOUNT_BYTES,
  MAX_BLOB_BYTES,
  readBytes,
  type Manifest,
} from '@cat/cloud-contracts';

// Leaves room for base64 expansion, SQLite indexes, project metadata and auth.
export const MAX_RESERVED_BYTES = 128 * 1024 * 1024;

export async function requireBlobs(env: Env, userId: string, manifest: Manifest): Promise<void> {
  return requireBlobHashes(env, userId, manifestHashes(manifest));
}

// Both protocol catalogs reference the same account-private immutable storage.
export async function requireBlobHashes(
  env: Env,
  userId: string,
  values: readonly string[],
): Promise<void> {
  const hashes = [...new Set(values)];
  if (hashes.length > 256 || hashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash)))
    throw new HttpError(400, 'Invalid blob references');
  for (let start = 0; start < hashes.length; start += 80) {
    const chunk = hashes.slice(start, start + 80);
    const result = await env.DB.prepare(
      `SELECT hash FROM cloud_blobs WHERE owner_id = ? AND ready = 1 AND hash IN (${chunk.map(() => '?').join(',')})`,
    )
      .bind(userId, ...chunk)
      .all();
    if (result.results.length !== chunk.length)
      throw new HttpError(400, 'Project references an unavailable blob');
  }
}

export async function handleBlob(
  request: Request,
  env: Env,
  userId: string,
  hash: string,
): Promise<Response> {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new HttpError(400, 'Invalid blob hash');
  const store = new D1BlobStore(env.DB);
  if (request.method === 'GET') {
    const row = await env.DB.prepare(
      'SELECT bytes, ready FROM cloud_blobs WHERE owner_id = ? AND hash = ?',
    )
      .bind(userId, hash)
      .first<{ bytes: number; ready: number }>();
    if (!row?.ready) throw new HttpError(404, 'Blob not found');
    return new Response(await store.get(userId, hash, row.bytes), {
      headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' },
    });
  }
  if (request.method !== 'PUT') throw new HttpError(405, 'Method not allowed');
  const bytes = await readBytes(request, MAX_BLOB_BYTES);
  if ((await digest(bytes)) !== hash) throw new HttpError(400, 'Content hash mismatch');
  // The conditional reservation and the unique owner/hash key bound account storage,
  // including concurrent uploads and abandoned reservations. All storage is private.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO cloud_blobs(owner_id, hash, bytes, created_at)
    SELECT ?, ?, ?, unixepoch() WHERE
    (SELECT COALESCE(SUM(bytes), 0) FROM cloud_blobs WHERE owner_id = ?) + ? <= ? AND
    (SELECT COALESCE(SUM(bytes), 0) FROM cloud_blobs) + ? <= ?`,
  )
    .bind(
      userId,
      hash,
      bytes.length,
      userId,
      bytes.length,
      MAX_ACCOUNT_BYTES,
      bytes.length,
      MAX_RESERVED_BYTES,
    )
    .run();
  const reservation = await env.DB.prepare(
    'SELECT bytes, ready FROM cloud_blobs WHERE owner_id = ? AND hash = ?',
  )
    .bind(userId, hash)
    .first<{ bytes: number; ready: number }>();
  if (!reservation) throw new HttpError(413, 'Experiment storage quota reached');
  if (reservation.bytes !== bytes.length) throw new HttpError(409, 'Blob reservation mismatch');
  if (!reservation.ready) {
    await store.put(userId, hash, bytes);
  }
  return Response.json({ hash });
}
