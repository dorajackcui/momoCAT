import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  digest,
  MAX_CLOUD_RESOURCES,
  MAX_PROJECTS,
  parseProjectManifestV2,
  type ProjectManifestV2,
  type ResourceManifestV2,
} from '@cat/cloud-contracts';
import { handleProjectsV2, handleResourcesV2 } from './catalogV2';
import { handleProjects } from './projects';
import type { Env } from './env';

// Real SQLite transactions exercise the Worker SQL and constraints, without auth mocks.
function d1(db: Database.Database, beforeBatch?: () => void): D1Database {
  const prepare = (sql: string, bindings: unknown[] = []) => ({
    bind: (...values: unknown[]) => prepare(sql, values),
    first: async () => db.prepare(sql).get(...bindings) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...bindings) }),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...bindings).changes } }),
    execute: () => ({ meta: { changes: db.prepare(sql).run(...bindings).changes } }),
  });
  return {
    prepare,
    batch: async (statements: ReturnType<typeof prepare>[]) => {
      beforeBatch?.();
      return db.transaction(() => statements.map((statement) => statement.execute()))();
    },
  } as unknown as D1Database;
}

describe('cloud V2 independent account resources and project relay', () => {
  let db: Database.Database;
  let env: Env;
  const hash = 'a'.repeat(64);
  const otherHash = 'b'.repeat(64);
  const resourceManifest: ResourceManifestV2 = {
    protocol: 2,
    schema: 15,
    kind: 'tm',
    data: [hash],
  };
  const projectManifest: ProjectManifestV2 = {
    protocol: 2,
    schema: 15,
    state: [hash],
    files: [{ id: 'file-uuid', chunks: [hash] }],
    resources: [{ id: 'shared-tm', kind: 'tm' }],
  };
  const request = (method: string, body?: unknown) =>
    new Request('https://cloud.example/v2/catalog', {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const project = (owner: string, path: string[], body?: unknown, method = 'POST') =>
    handleProjectsV2(request(method, body), env, owner, path);
  const resource = (owner: string, path: string[], body?: unknown, method = 'POST') =>
    handleResourcesV2(request(method, body), env, owner, path);
  const createResource = (id = 'shared-tm', owner = 'alice', kind: 'tm' | 'tb' = 'tm') =>
    resource(owner, [], {
      id,
      kind,
      name: id,
      srcLang: 'en',
      tgtLang: 'zh',
      manifest: { ...resourceManifest, kind },
    });
  const createProject = (id = 'project-a') =>
    project('alice', [], { id, name: id, manifest: projectManifest });

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    for (const migration of ['0001_cloud.sql', '0003_blob_parts.sql', '0004_cloud_v2.sql'])
      db.exec(readFileSync(new NodeURL(`../migrations/${migration}`, import.meta.url), 'utf8'));
    for (const owner of ['alice', 'bob'])
      for (const value of [hash, otherHash])
        db.prepare('INSERT INTO cloud_blobs VALUES (?, ?, 10, 1, unixepoch())').run(owner, value);
    env = { DB: d1(db) } as Env;
  });
  afterEach(() => db.close());

  it('keeps the V1 catalog and bytes intact when V2 catalogs are used', async () => {
    const manifest = { protocol: 1, schema: 15, state: [hash], resources: [hash], files: [] };
    await handleProjects(
      request('POST', {
        mode: 'relay',
        id: 'project-a',
        name: 'Legacy',
        manifest,
      }),
      env,
      'alice',
      [],
    );
    const before = db.prepare('SELECT * FROM cloud_projects').get();
    await createResource();
    await createProject();
    expect(db.prepare('SELECT * FROM cloud_projects').get()).toEqual(before);
    expect(
      await (await handleProjects(request('GET'), env, 'alice', ['project-a'])).json(),
    ).toMatchObject({ name: 'Legacy', manifest });
    expect(await (await project('alice', ['project-a'], undefined, 'GET')).json()).toMatchObject({
      name: 'project-a',
      manifest: projectManifest,
    });
  });

  it('isolates catalog reads, updates, and project mounts by account and kind', async () => {
    await createResource();
    await createProject();
    expect(await (await project('bob', [], undefined, 'GET')).json()).toEqual([]);
    expect(await (await resource('bob', [], undefined, 'GET')).json()).toEqual([]);
    for (const read of [project, resource])
      await expect(
        read('bob', [read === project ? 'project-a' : 'shared-tm'], undefined, 'GET'),
      ).rejects.toMatchObject({ status: 404 });
    await expect(resource('bob', ['shared-tm', 'commit'], {})).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      project('bob', [], { id: 'bob-project', name: 'Other', manifest: projectManifest }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      project('alice', [], {
        id: 'wrong-kind',
        name: 'Wrong',
        manifest: { ...projectManifest, resources: [{ id: 'shared-tm', kind: 'tb' }] },
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(createResource('shared-tm', 'bob')).rejects.toMatchObject({ status: 409 });
  });

  it('shares one resource between projects without letting project sync overwrite its head', async () => {
    await createResource();
    await createResource('shared-tb', 'alice', 'tb');
    await createProject('project-a');
    await createProject('project-b');
    const head = { ...resourceManifest, data: [otherHash] };
    expect(
      await (
        await resource('alice', ['shared-tm', 'commit'], {
          revision: 1,
          operationId: 'resource-change',
          manifest: head,
        })
      ).json(),
    ).toEqual({ revision: 2 });
    await project('alice', ['project-a', 'commit'], {
      revision: 1,
      operationId: 'project-change',
      manifest: projectManifest,
    });
    expect(await (await resource('alice', ['shared-tm'], undefined, 'GET')).json()).toMatchObject({
      revision: 2,
      manifest: head,
    });
    const entries = await (await resource('alice', [], undefined, 'GET')).json();
    expect(entries).toHaveLength(2);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'shared-tb', kind: 'tb', srcLang: 'en', tgtLang: 'zh' }),
      ]),
    );
  });

  it.each(['project', 'resource'] as const)(
    'conditionally commits %s renames and recovers lost replies',
    async (kind) => {
      await createResource();
      await createProject();
      const call = kind === 'project' ? project : resource;
      const id = kind === 'project' ? 'project-a' : 'shared-tm';
      const manifest = kind === 'project' ? projectManifest : resourceManifest;
      const body = { revision: 1, operationId: 'first', name: 'Renamed', manifest };
      expect(await (await call('alice', [id, 'commit'], body)).json()).toEqual({ revision: 2 });
      await expect(
        call('alice', [id, 'commit'], { ...body, operationId: 'stale' }),
      ).rejects.toMatchObject({ status: 409 });
      await call('alice', [id, 'commit'], {
        revision: 2,
        operationId: 'next',
        name: 'Newer name',
        manifest,
      });
      expect(await (await call('alice', [id, 'commit'], body)).json()).toEqual({ revision: 2 });
      await expect(
        call('alice', [id, 'commit'], { ...body, name: 'Different payload' }),
      ).rejects.toMatchObject({ status: 409 });
      expect(await (await call('alice', [id], undefined, 'GET')).json()).toMatchObject({
        revision: 3,
        name: 'Newer name',
      });
    },
  );

  it('does not turn concurrent operation-ID reuse into an additional write', async () => {
    await createResource();
    const previousHash = await digest(
      new TextEncoder().encode(
        JSON.stringify({
          expected: 1,
          manifest: resourceManifest,
        }),
      ),
    );
    env.DB = d1(db, () => {
      db.prepare('UPDATE cloud_v2_resources SET revision = 2, last_operation = ?').run('reused');
      db.prepare('INSERT INTO cloud_v2_resource_operations VALUES (?, ?, ?, ?)').run(
        'shared-tm',
        'reused',
        previousHash,
        2,
      );
    });
    await expect(
      resource('alice', ['shared-tm', 'commit'], {
        revision: 2,
        operationId: 'reused',
        manifest: { ...resourceManifest, data: [otherHash] },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(db.prepare('SELECT revision, manifest FROM cloud_v2_resources').get()).toEqual({
      revision: 2,
      manifest: JSON.stringify(resourceManifest),
    });
  });

  it('rolls back the catalog head if persisting its operation receipt fails', async () => {
    await createResource();
    db.exec(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON cloud_v2_resource_operations BEGIN SELECT RAISE(ABORT, 'interrupted'); END",
    );
    await expect(
      resource('alice', ['shared-tm', 'commit'], {
        revision: 1,
        operationId: 'broken',
        name: 'Changed',
        manifest: resourceManifest,
      }),
    ).rejects.toThrow('interrupted');
    expect(await (await resource('alice', ['shared-tm'], undefined, 'GET')).json()).toMatchObject({
      revision: 1,
      name: 'shared-tm',
    });
  });

  it('rejects foreign, pending and missing blobs before changing either catalog', async () => {
    await createResource();
    await createProject();
    db.prepare('DELETE FROM cloud_blobs WHERE owner_id = ? AND hash = ?').run('alice', otherHash);
    await expect(
      resource('alice', ['shared-tm', 'commit'], {
        revision: 1,
        operationId: 'foreign-blob',
        manifest: { ...resourceManifest, data: [otherHash] },
      }),
    ).rejects.toMatchObject({ status: 400 });
    db.prepare('INSERT INTO cloud_blobs VALUES (?, ?, 10, 0, unixepoch())').run('alice', otherHash);
    await expect(
      project('alice', ['project-a', 'commit'], {
        revision: 1,
        operationId: 'pending-blob',
        manifest: { ...projectManifest, state: [otherHash] },
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(db.prepare('SELECT revision FROM cloud_v2_projects').get()).toEqual({ revision: 1 });
    expect(db.prepare('SELECT revision FROM cloud_v2_resources').get()).toEqual({ revision: 1 });
  });

  it('enforces protocol, resource kind, route shape, and explicit absence of deletion', async () => {
    await createResource();
    await expect(
      resource('alice', ['shared-tm', 'commit'], {
        revision: 1,
        operationId: 'change-kind',
        manifest: { ...resourceManifest, kind: 'tb' },
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      resource('alice', [], {
        id: 'mismatch',
        kind: 'tb',
        name: 'Mismatch',
        srcLang: 'en',
        tgtLang: 'zh',
        manifest: resourceManifest,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      project('alice', [], {
        id: 'old',
        name: 'Old',
        manifest: { ...projectManifest, protocol: 1 },
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(resource('alice', ['shared-tm'], undefined, 'DELETE')).rejects.toMatchObject({
      status: 405,
    });
    await expect(resource('alice', ['shared-tm', 'commit', 'extra'], {})).rejects.toMatchObject({
      status: 404,
    });
    await expect(resource('alice', ['shared-tm', 'lease'], {})).rejects.toMatchObject({
      status: 404,
    });
    await expect(resource('alice', ['shared-tm'], {}, 'POST')).rejects.toMatchObject({
      status: 405,
    });
    await expect(
      resource('alice', ['shared-tm', 'commit'], {
        revision: 1,
        operationId: 'change-language',
        manifest: resourceManifest,
        srcLang: 'ja',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      (await resource('alice', ['shared-tm'], undefined, 'GET')).headers.get('Cache-Control'),
    ).toBe('no-store');
  });

  it('bounds both catalogs and still permits an identical create retry at the limit', async () => {
    for (let i = 0; i < MAX_CLOUD_RESOURCES; i++)
      await createResource(i ? `resource-${i}` : 'shared-tm');
    expect((await createResource()).status).toBe(201);
    await expect(createResource('over-limit')).rejects.toMatchObject({ status: 409 });
    // Legacy projects also consume the existing account project allowance.
    db.prepare(
      'INSERT INTO cloud_projects(id, owner_id, name, manifest, updated_at) VALUES (?, ?, ?, ?, unixepoch())',
    ).run('legacy', 'alice', 'Legacy', '{}');
    for (let i = 0; i < MAX_PROJECTS - 1; i++)
      await createProject(i ? `project-${i}` : 'project-a');
    expect((await createProject()).status).toBe(201);
    await expect(createProject('over-limit')).rejects.toMatchObject({ status: 409 });
  });

  it('does not alias separately scoped project/resource operation IDs', async () => {
    await createResource('shared-id');
    await project('alice', [], {
      id: 'shared-id',
      name: 'Project',
      manifest: { ...projectManifest, resources: [{ id: 'shared-id', kind: 'tm' }] },
    });
    await resource('alice', ['shared-id', 'commit'], {
      revision: 1,
      operationId: 'same-op',
      manifest: resourceManifest,
    });
    await project('alice', ['shared-id', 'commit'], {
      revision: 1,
      operationId: 'same-op',
      manifest: parseProjectManifestV2({
        ...projectManifest,
        resources: [{ id: 'shared-id', kind: 'tm' }],
      }),
    });
    expect(db.prepare('SELECT COUNT(*) count FROM cloud_v2_project_operations').get()).toEqual({
      count: 1,
    });
    expect(db.prepare('SELECT COUNT(*) count FROM cloud_v2_resource_operations').get()).toEqual({
      count: 1,
    });
  });
});
