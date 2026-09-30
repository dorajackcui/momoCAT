import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATDatabase, exportCloudProject } from '@cat/db';
import { MAX_BLOB_BYTES, type CloudProject } from '@cat/cloud-contracts';
import { CloudAccountSession } from './CloudAccountSession';
import { CloudConnection, cloudChunkHashes } from './CloudConnection';
import { migrateLegacyCloudProject } from './CloudLegacyMigration';
import { CloudProjectSession } from './CloudProjectSession';
import { internalProjectFilePath } from '../services/modules/projectFileStorage';

vi.mock('electron', () => ({ safeStorage: {}, shell: {} }));

describe('legacy cloud cache migration', () => {
  const directories: string[] = [];
  const accounts = new Set<CloudAccountSession>();
  afterEach(() => {
    for (const account of accounts) account.dispose();
    accounts.clear();
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  async function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'momocat-legacy-migration-'));
    directories.push(directory);
    const sourcePath = join(directory, 'source.db');
    const source = new CATDatabase(sourcePath);
    const project = source.createProject('Legacy cloud project', 'en', 'zh');
    const first = source.createFile(project, 'same.xlsx');
    const second = source.createFile(project, 'same.xlsx');
    const sql = new Database(sourcePath);
    sql.prepare('UPDATE files SET createdAt=? WHERE id=?').run('2026-01-01', first);
    sql.prepare('UPDATE files SET createdAt=? WHERE id=?').run('2026-01-02', second);
    sql.close();
    const tm = source.createTM('Legacy Main TM', 'en', 'zh', 'main');
    const tb = source.createTermBase('Legacy TB', 'en', 'zh');
    source.mountTMToProject(project, tm, 3, 'readwrite');
    source.mountTermBaseToProject(project, tb, 4);
    source.insertTBEntryIfAbsentBySrcTerm({
      id: 'legacy-term',
      tbId: tb,
      srcLang: 'en',
      srcTerm: 'orchard',
      tgtTerm: '果园',
    });
    const oldUUID = source.getProject(project)!.uuid;
    source.close();
    const snapshot = exportCloudProject(sourcePath, project);
    const blobs = new Map<string, Buffer>();
    const storeBytes = (bytes: Uint8Array) => {
      const hashes = cloudChunkHashes(bytes);
      hashes.forEach((hash, index) =>
        blobs.set(
          hash,
          Buffer.from(bytes.subarray(index * MAX_BLOB_BYTES, (index + 1) * MAX_BLOB_BYTES)),
        ),
      );
      return hashes;
    };
    const remote: CloudProject = {
      id: 'legacy-cloud-id',
      name: 'Legacy cloud project',
      revision: 1,
      updatedAt: 1,
      manifest: {
        protocol: 1,
        schema: 15,
        state: storeBytes(Buffer.from(JSON.stringify(snapshot.state))),
        resources: storeBytes(Buffer.from(JSON.stringify(snapshot.resources))),
        files: [
          { id: first, chunks: storeBytes(Buffer.from('first original bytes')) },
          { id: second, chunks: storeBytes(Buffer.from('second original bytes')) },
        ],
      },
    };
    const json = vi.fn(async (route: string, method = 'GET') => {
      if (method === 'GET' && route === `/v1/projects/${remote.id}`) return structuredClone(remote);
      throw new Error(`Unexpected migration request: ${method} ${route}`);
    });
    const download = vi.fn(async (hashes: string[]) =>
      Buffer.concat(
        hashes.map((hash) => {
          const bytes = blobs.get(hash);
          if (!bytes) throw new Error('Missing test blob');
          return bytes;
        }),
      ),
    );
    const upload = vi.fn(async () => {
      throw new Error('Migration must not upload');
    });
    const connection = {
      json,
      download,
      upload,
      account: { id: 'alice', name: 'Alice', email: 'alice@example.test' },
    } as unknown as CloudConnection;
    const legacy = new CloudProjectSession(remote, connection, join(directory, remote.id));
    await legacy.open();
    legacy.db.updateProjectAISettings(legacy.projectId, 'Unpublished device draft', '');
    legacy.db.renameTM(tm, 'Unpublished Main TM draft');
    const sourceFiles = legacy.db.listFiles(legacy.projectId);
    const expected = new Map(
      sourceFiles.map((file) => [
        file.createdAt,
        file.createdAt === '2026-01-01'
          ? 'first locally saved bytes'
          : 'second locally saved bytes',
      ]),
    );
    for (const file of sourceFiles)
      writeFileSync(
        internalProjectFilePath(legacy.projectsDir, file),
        expected.get(file.createdAt)!,
      );
    const legacyPath = legacy.dbPath;
    const legacyProjectsDir = legacy.projectsDir;
    const legacyProjectId = legacy.projectId;
    legacy.dispose();
    remote.revision = 9;
    const account = new CloudAccountSession(join(directory, 'account-v2'), connection);
    await account.initialize();
    accounts.add(account);
    json.mockClear();
    download.mockClear();
    return {
      account,
      connection,
      remote,
      json,
      download,
      upload,
      expected,
      sourceFiles,
      oldUUID,
      tm,
      tb,
      legacyPath,
      legacyProjectId,
      legacyProjectsDir,
      directory,
    };
  }

  it('preserves the locally edited V1 cache and copies same-name originals by exact source identity without publishing', async () => {
    const f = await fixture();
    const before = exportCloudProject(f.legacyPath, f.legacyProjectId);
    const metadata = readFileSync(join(f.directory, f.remote.id, 'cache.json'), 'utf8');
    const id = await migrateLegacyCloudProject(f.account, f.connection, f.remote.id);
    const copy = f.account.db.getProject(id)!;
    expect(copy).toMatchObject({ uuid: f.remote.id, aiPrompt: 'Unpublished device draft' });
    expect(copy.uuid).not.toBe(f.oldUUID);
    expect(f.account.status(id).pending).toBe(true);
    expect(f.account.tracker.get('project', f.remote.id)?.revision ?? 0).toBe(0);
    const mountedTM = f.account.db
      .getProjectMountedTMs(id)
      .find((resource) => resource.type === 'main')!;
    expect(mountedTM).toMatchObject({ name: 'Unpublished Main TM draft' });
    expect(mountedTM.id).not.toBe(f.tm);
    const term = f.account.db.listProjectTermEntries(id)[0];
    expect(term.tgtTerm).toBe('果园');
    expect(term.tbId).not.toBe(f.tb);
    const files = f.account.db.listFiles(id);
    expect(files).toHaveLength(2);
    for (const file of files) {
      expect(f.sourceFiles.some((original) => original.uuid === file.uuid)).toBe(false);
      expect(readFileSync(internalProjectFilePath(f.account.projectsDir, file), 'utf8')).toBe(
        f.expected.get(file.createdAt),
      );
    }
    expect(exportCloudProject(f.legacyPath, f.legacyProjectId)).toEqual(before);
    expect(readFileSync(join(f.directory, f.remote.id, 'cache.json'), 'utf8')).toBe(metadata);
    for (const file of f.sourceFiles)
      expect(readFileSync(internalProjectFilePath(f.legacyProjectsDir, file), 'utf8')).toBe(
        f.expected.get(file.createdAt),
      );
    expect(f.json).toHaveBeenCalledTimes(1);
    expect(f.json).toHaveBeenCalledWith(`/v1/projects/${f.remote.id}`);
    expect(f.download).not.toHaveBeenCalled();
    expect(f.upload).not.toHaveBeenCalled();
  });

  it('rolls back the entire V2 clone if an original file cannot be copied', async () => {
    const f = await fixture();
    rmSync(internalProjectFilePath(f.legacyProjectsDir, f.sourceFiles[1]));
    await expect(migrateLegacyCloudProject(f.account, f.connection, f.remote.id)).rejects.toThrow();
    expect(f.account.db.listProjects()).toEqual([]);
    expect(f.account.db.listTMs('main')).toEqual([]);
    expect(f.account.db.listTermBases()).toEqual([]);
    expect(existsSync(join(f.account.projectsDir, '1'))).toBe(false);
    expect(f.upload).not.toHaveBeenCalled();
  });
});
