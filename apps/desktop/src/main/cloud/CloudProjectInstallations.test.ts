import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CATDatabase,
  acknowledgeCloudInstallReceipt,
  CloudAccountTracker,
  exportCloudAccountProject,
  getCloudInstallReceipt,
  restoreCloudAccountProject,
  type ProjectSnapshotV2,
} from '@cat/db';
import { CloudProjectInstallations } from './CloudProjectInstallations';

const digest = 'a'.repeat(64);
describe('durable cloud project installation', () => {
  let directory: string;
  let dbPath: string;
  let projectsDir: string;
  let db: CATDatabase;
  let tracker: CloudAccountTracker;
  let installer: CloudProjectInstallations;
  let projectId: number;
  let snapshot: ProjectSnapshotV2;
  let originalPath: string;
  const raw = (sql: string) => {
    const connection = new Database(dbPath);
    try {
      connection.exec(sql);
    } finally {
      connection.close();
    }
  };
  function reopen(): void {
    tracker.close();
    db.close();
    db = new CATDatabase(dbPath);
    tracker = new CloudAccountTracker(dbPath);
    installer = new CloudProjectInstallations(db, dbPath, projectsDir, directory);
  }
  function restore(id: string, failBeforeCommit = false): number {
    const staging = installer.staging(id);
    mkdirSync(staging);
    writeFileSync(join(staging, snapshot.files[0].uuid), 'new remote original');
    return restoreCloudAccountProject(dbPath, snapshot, (restoredId, files) => {
      for (const file of files)
        renameSync(join(staging, file.uuid), join(staging, `${file.id}_${file.name}`));
      const receipt = installer.install(id, restoredId, snapshot.project.uuid, 2, digest);
      if (failBeforeCommit) throw new Error('Simulated process exit before SQL commit');
      return receipt;
    });
  }
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'momocat-cloud-install-'));
    dbPath = join(directory, 'cat_v1.db');
    projectsDir = join(directory, 'projects');
    mkdirSync(projectsDir);
    db = new CATDatabase(dbPath);
    tracker = new CloudAccountTracker(dbPath);
    installer = new CloudProjectInstallations(db, dbPath, projectsDir, directory);
    installer.initialize();
    projectId = db.createProject('Relay', 'en', 'zh');
    const fileId = db.createFile(projectId, 'original.csv', JSON.stringify({ sourceCol: 0 }));
    mkdirSync(join(projectsDir, String(projectId)));
    originalPath = join(projectsDir, String(projectId), `${fileId}_original.csv`);
    writeFileSync(originalPath, 'old original');
    const uuid = db.getProject(projectId)!.uuid;
    tracker.acknowledge('project', uuid, 1, 'b'.repeat(64));
    snapshot = exportCloudAccountProject(dbPath, projectId);
    snapshot.project.aiPrompt = 'Downloaded project';
  });
  afterEach(() => {
    tracker.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('restores old originals when installation happened before a rolled-back SQL commit', () => {
    const id = randomUUID();
    expect(() => restore(id, true)).toThrow('before SQL commit');
    expect(readFileSync(originalPath, 'utf8')).toBe('new remote original');
    expect(db.getProject(projectId)!.aiPrompt).not.toBe('Downloaded project');
    expect(getCloudInstallReceipt(dbPath, id)).toBeUndefined();
    reopen();
    installer.recover();
    expect(readFileSync(originalPath, 'utf8')).toBe('old original');
    expect(tracker.get('project', snapshot.project.uuid)!.revision).toBe(1);
    expect(readdirSync(join(directory, 'project-installations'))).toEqual([]);
  });

  it('retains committed originals and acknowledges exactly the installed generation after restart', () => {
    const id = randomUUID();
    expect(restore(id)).toBe(projectId);
    const receipt = getCloudInstallReceipt(dbPath, id)!;
    expect(receipt.acknowledged).toBe(0);
    expect(receipt.generation).toBe(tracker.get('project', snapshot.project.uuid)!.generation);
    reopen();
    installer.recover();
    expect(db.getProject(projectId)!.aiPrompt).toBe('Downloaded project');
    expect(readFileSync(originalPath, 'utf8')).toBe('new remote original');
    expect(tracker.get('project', snapshot.project.uuid)).toMatchObject({
      revision: 2,
      signature: digest,
      confirmed: receipt.generation,
      generation: receipt.generation,
    });
    expect(getCloudInstallReceipt(dbPath, id)).toBeUndefined();
    expect(readdirSync(projectsDir)).toEqual([String(projectId)]);
  });

  it('preserves edits and a newer pending upload made after a failed installation acknowledgement', () => {
    const id = randomUUID();
    restore(id);
    const generation = getCloudInstallReceipt(dbPath, id)!.generation;
    raw(`CREATE TRIGGER fail_install_ack BEFORE UPDATE OF revision ON cloud_objects
      BEGIN SELECT RAISE(ABORT, 'Simulated acknowledgement failure'); END;`);
    expect(() => installer.complete(id)).toThrow('acknowledgement failure');
    db.updateProjectAISettings(projectId, 'Later local draft', '');
    writeFileSync(originalPath, 'later local original');
    const current = tracker.get('project', snapshot.project.uuid)!;
    const pending = JSON.stringify({ generation: current.generation, operationId: 'later-upload' });
    tracker.prepare('project', snapshot.project.uuid, pending);
    raw('DROP TRIGGER fail_install_ack');
    reopen();
    installer.recover();
    expect(db.getProject(projectId)!.aiPrompt).toBe('Later local draft');
    expect(readFileSync(originalPath, 'utf8')).toBe('later local original');
    expect(tracker.get('project', snapshot.project.uuid)).toMatchObject({
      revision: 2,
      confirmed: generation,
      generation: current.generation,
      pending,
    });
    expect(current.generation).toBeGreaterThan(generation);
  });

  it('does not repeat an acknowledged installation after interrupted filesystem cleanup', () => {
    const id = randomUUID();
    restore(id);
    // Simulate a process exit between the atomic acknowledgement and removal
    // of the journal, followed by another publication and a new local draft.
    const receipt = getCloudInstallReceipt(dbPath, id)!;
    acknowledgeCloudInstallReceipt(dbPath, id, 2, digest);
    expect(getCloudInstallReceipt(dbPath, id)!.acknowledged).toBe(1);
    tracker.acknowledge('project', snapshot.project.uuid, 3, 'c'.repeat(64));
    db.updateProjectAISettings(projectId, 'Newer local work', '');
    const before = tracker.get('project', snapshot.project.uuid)!;
    reopen();
    installer.recover();
    expect(tracker.get('project', snapshot.project.uuid)).toMatchObject({
      revision: 3,
      signature: 'c'.repeat(64),
      generation: before.generation,
      confirmed: before.confirmed,
    });
    expect(before.generation).toBeGreaterThan(receipt.generation);
  });

  it('rejects a journal with an out-of-scope project destination before touching files', () => {
    const id = randomUUID();
    restore(id, false);
    const journal = join(directory, 'project-installations', `${id}.json`);
    const value = JSON.parse(readFileSync(journal, 'utf8'));
    value.projectId = '../outside';
    writeFileSync(journal, JSON.stringify(value));
    reopen();
    expect(() => installer.recover()).toThrow('Invalid cloud installation journal');
    expect(readFileSync(originalPath, 'utf8')).toBe('new remote original');
    expect(existsSync(journal)).toBe(true);
  });
});
