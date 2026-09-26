import { Buffer } from 'node:buffer';

// Keep individual bound values below D1's row limit and a full 4 MiB upload
// below the free plan's 50-query limit, including authentication queries.
export const D1_PART_BYTES = 256 * 1024;

export class D1BlobStore {
  constructor(private readonly db: D1Database) {}

  async get(owner: string, hash: string, size: number): Promise<Uint8Array> {
    const result = await this.db
      .prepare(
        'SELECT part_index, data FROM cloud_blob_parts WHERE owner_id = ? AND hash = ? ORDER BY part_index',
      )
      .bind(owner, hash)
      .all<{ part_index: number; data: string }>();
    const rows = result.results;
    if (rows.length !== Math.ceil(size / D1_PART_BYTES)) throw new Error('Incomplete cloud blob');
    const chunks = rows.map((row, index) => {
      const bytes = Buffer.from(row.data, 'base64');
      if (
        row.part_index !== index ||
        bytes.length !== Math.min(D1_PART_BYTES, size - index * D1_PART_BYTES)
      )
        throw new Error('Invalid cloud blob part');
      return bytes;
    });
    return new Uint8Array(Buffer.concat(chunks));
  }

  async put(owner: string, hash: string, bytes: Uint8Array): Promise<void> {
    const statements: D1PreparedStatement[] = [];
    for (let offset = 0; offset < bytes.length; offset += D1_PART_BYTES) {
      // Base64 avoids D1's JSON array encoding for each individual binary byte.
      const data = Buffer.from(bytes.subarray(offset, offset + D1_PART_BYTES)).toString('base64');
      statements.push(
        this.db
          .prepare(
            'INSERT OR IGNORE INTO cloud_blob_parts(owner_id, hash, part_index, data) VALUES (?, ?, ?, ?)',
          )
          .bind(owner, hash, offset / D1_PART_BYTES, data),
      );
    }
    statements.push(
      this.db
        .prepare('UPDATE cloud_blobs SET ready = 1 WHERE owner_id = ? AND hash = ?')
        .bind(owner, hash),
    );
    // D1 batches are transactions: incomplete writes never become visible as ready.
    await this.db.batch(statements);
  }
}
