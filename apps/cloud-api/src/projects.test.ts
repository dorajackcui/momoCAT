import Database from 'better-sqlite3';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleProjects } from './projects';
import { handleBlob, MAX_RESERVED_BYTES } from './blobs';
import { D1_PART_BYTES } from './D1BlobStore';
import type { Env } from './env';
import { digest, MAX_ACCOUNT_BYTES, MAX_BLOB_BYTES, type Manifest } from '@cat/cloud-contracts';

// SQLite-backed D1 test adapter: real SQL, unique constraints and atomic batches.
// Production always uses the Worker bindings; this adapter is never deployed.
function d1(db: Database.Database): D1Database {
  const prepare = (sql: string, bindings: unknown[] = []) => ({
    bind: (...values: unknown[]) => prepare(sql, values),
    first: async () => db.prepare(sql).get(...bindings) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...bindings) }),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...bindings).changes } }),
    execute: () => ({ meta: { changes: db.prepare(sql).run(...bindings).changes } }),
  });
  return {
    prepare,
    batch: async (statements: ReturnType<typeof prepare>[]) =>
      db.transaction(() => statements.map((s) => s.execute()))(),
  } as unknown as D1Database;
}

describe('cloud project storage and manual relay', () => {
  let db: Database.Database;
  let env: Env;
  const hash = 'a'.repeat(64);
  const otherHash = 'b'.repeat(64);
  const manifest: Manifest = {
    protocol: 1,
    schema: 15,
    state: [hash],
    resources: [hash],
    files: [],
  };
  const request = (method: string, body?: unknown) =>
    new Request('https://cloud.example/v1/projects', {
      method,
      body: body ? JSON.stringify(body) : undefined,
    });
  const call = (owner: string, path: string[], body?: unknown, method = 'POST') =>
    handleProjects(request(method, body), env, owner, path);
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(readFileSync(new NodeURL('../migrations/0001_cloud.sql', import.meta.url), 'utf8'));
    db.exec(
      readFileSync(new NodeURL('../migrations/0003_blob_parts.sql', import.meta.url), 'utf8'),
    );
    for (const h of [hash, otherHash])
      db.prepare('INSERT INTO cloud_blobs VALUES (?, ?, 10, 1, unixepoch())').run('alice', h);
    env = { DB: d1(db) } as Env;
  });
  afterEach(() => db.close());
  const create = () =>
    call('alice', [], { mode: 'relay', id: 'project-a', name: 'Experiment', manifest });
  it('isolates listing, reads, writes and blobs by account', async () => {
    await create();
    expect(await (await call('bob', [], undefined, 'GET')).json()).toEqual([]);
    await expect(call('bob', ['project-a'], undefined, 'GET')).rejects.toMatchObject({
      status: 404,
    });
    await expect(call('bob', ['project-a', 'commit'], { mode: 'relay' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      handleBlob(new Request('https://cloud.example/blob'), env, 'bob', hash),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      call('bob', [], { mode: 'relay', id: 'b', name: 'Other', manifest }),
    ).rejects.toMatchObject({
      status: 400,
    });
  });
  it('creates idempotently, commits all project content and rejects a stale device', async () => {
    await create();
    await create();
    const body = {
      mode: 'relay',
      revision: 1,
      operationId: 'device-a',
      manifest: {
        ...manifest,
        state: [otherHash],
        resources: [otherHash],
        files: [{ id: 7, chunks: [hash] }],
      },
    };
    expect(await (await call('alice', ['project-a', 'commit'], body)).json()).toEqual({
      revision: 2,
    });
    await expect(
      call('alice', ['project-a', 'commit'], { ...body, operationId: 'device-b' }),
    ).rejects.toMatchObject({ status: 409 });
    // A lost response is retried even after another device has advanced the head.
    await call('alice', ['project-a', 'commit'], { ...body, revision: 2, operationId: 'device-c' });
    expect(await (await call('alice', ['project-a', 'commit'], body)).json()).toEqual({
      revision: 2,
    });
    await expect(
      call('alice', ['project-a', 'commit'], { ...body, manifest }),
    ).rejects.toMatchObject({ status: 409 });
    expect(db.prepare('SELECT revision FROM cloud_projects').get()).toEqual({ revision: 3 });
  });
  it('rejects old auto-sync clients and missing blobs without changing the head', async () => {
    await expect(
      call('alice', [], { id: 'old', name: 'Old client', manifest }),
    ).rejects.toMatchObject({ status: 426 });
    await create();
    await expect(call('alice', ['project-a', 'lease'], { deviceId: 'old' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      call('alice', ['project-a', 'commit'], { revision: 1, operationId: 'old', manifest }),
    ).rejects.toMatchObject({ status: 426 });
    await expect(
      call('alice', ['project-a', 'commit'], {
        mode: 'relay',
        revision: 1,
        operationId: 'missing',
        manifest: { ...manifest, resources: ['c'.repeat(64)] },
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(db.prepare('SELECT revision FROM cloud_projects').get()).toEqual({ revision: 1 });
    expect(db.prepare('SELECT COUNT(*) count FROM cloud_operations').get()).toEqual({ count: 0 });
  });
  it('validates uploaded content before storage and deduplicates same-account blobs', async () => {
    const bytes = new TextEncoder().encode('Cloud fixture');
    const expectedHash = await digest(bytes);
    const upload = (h: string) =>
      handleBlob(
        new Request('https://cloud.example/blob', { method: 'PUT', body: bytes }),
        env,
        'alice',
        h,
      );
    await expect(upload(hash)).rejects.toMatchObject({ status: 400 });
    expect(db.prepare('SELECT COUNT(*) count FROM cloud_blob_parts').get()).toEqual({ count: 0 });
    await upload(expectedHash);
    await upload(expectedHash);
    expect(db.prepare('SELECT COUNT(*) count FROM cloud_blob_parts').get()).toEqual({ count: 1 });
    const result = await handleBlob(
      new Request('https://cloud.example/blob'),
      env,
      'alice',
      expectedHash,
    );
    expect(await result.text()).toBe('Cloud fixture');
  });

  it('round-trips a maximum-size binary blob across D1 rows and isolates its parts', async () => {
    const bytes = Uint8Array.from({ length: MAX_BLOB_BYTES }, (_, index) => index % 251);
    const hash = await digest(bytes);
    await handleBlob(
      new Request('https://cloud.example/blob', { method: 'PUT', body: bytes }),
      env,
      'alice',
      hash,
    );
    const result = await handleBlob(new Request('https://cloud.example/blob'), env, 'alice', hash);
    expect(Buffer.from(await result.arrayBuffer()).equals(bytes)).toBe(true);
    expect(
      db.prepare('SELECT COUNT(*) count, MAX(length(data)) size FROM cloud_blob_parts').get(),
    ).toEqual({ count: 16, size: 349528 });
    await expect(
      handleBlob(new Request('https://cloud.example/blob'), env, 'bob', hash),
    ).rejects.toMatchObject({ status: 404 });
    db.prepare('DELETE FROM cloud_blob_parts WHERE part_index = 1').run();
    await expect(
      handleBlob(new Request('https://cloud.example/blob'), env, 'alice', hash),
    ).rejects.toThrow('Incomplete');
  });

  it('rolls back partial uploads, keeps them unreadable and permits retry', async () => {
    const bytes = new Uint8Array(D1_PART_BYTES + 1).fill(7);
    const hash = await digest(bytes);
    const upload = () =>
      handleBlob(
        new Request('https://cloud.example/blob', { method: 'PUT', body: bytes }),
        env,
        'alice',
        hash,
      );
    db.exec(
      "CREATE TRIGGER fail_part BEFORE INSERT ON cloud_blob_parts WHEN new.part_index = 1 BEGIN SELECT RAISE(ABORT, 'interrupted'); END",
    );
    await expect(upload()).rejects.toThrow('interrupted');
    expect(db.prepare('SELECT COUNT(*) count FROM cloud_blob_parts').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT ready FROM cloud_blobs WHERE hash = ?').get(hash)).toEqual({
      ready: 0,
    });
    await expect(
      handleBlob(new Request('https://cloud.example/blob'), env, 'alice', hash),
    ).rejects.toMatchObject({ status: 404 });
    db.exec('DROP TRIGGER fail_part');
    await upload();
    expect(db.prepare('SELECT ready FROM cloud_blobs WHERE hash = ?').get(hash)).toEqual({
      ready: 1,
    });
  });

  it.each(['account', 'database'] as const)(
    'bounds reserved %s storage while allowing an existing upload retry',
    async (scope) => {
      db.exec('DELETE FROM cloud_blobs');
      const bytes = new TextEncoder().encode('Stored fixture');
      const hash = await digest(bytes);
      const upload = (body: Uint8Array, h: string) =>
        handleBlob(
          new Request('https://cloud.example/blob', { method: 'PUT', body }),
          env,
          'alice',
          h,
        );
      await upload(bytes, hash);
      let remaining = (scope === 'account' ? MAX_ACCOUNT_BYTES : MAX_RESERVED_BYTES) - bytes.length;
      for (let index = 0; remaining > 0; index++) {
        const size = Math.min(remaining, MAX_BLOB_BYTES);
        db.prepare('INSERT INTO cloud_blobs VALUES (?, ?, ?, 0, unixepoch())').run(
          scope === 'account' ? 'alice' : `other-${index}`,
          `reserved-${index}`,
          size,
        );
        remaining -= size;
      }
      await upload(bytes, hash);
      const extra = new Uint8Array([42]);
      await expect(upload(extra, await digest(extra))).rejects.toMatchObject({ status: 413 });
      expect(db.prepare('SELECT COUNT(*) count FROM cloud_blob_parts').get()).toEqual({ count: 1 });
    },
  );
});
