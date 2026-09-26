import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CATDatabase } from '../index';
import {
  CloudSnapshotOutbox,
  exportCloudProject,
  restoreCloudProject,
} from './CloudProjectSnapshot';

describe('cloud project snapshots and durable outbox', () => {
  let directory: string;
  let original: CATDatabase;
  let project: number;
  let source: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'momocat-cloud-'));
    source = join(directory, 'source.db');
    original = new CATDatabase(source);
    project = original.createProject('Selected', 'en', 'zh');
    original.createFile(project, 'source.xlsx');
    original.createProject('Unrelated private project', 'ja', 'en');
    original.setSetting('openai_api_key', 'test-private-key');
    const tm = original.createTM('Mounted TM', 'en', 'zh', 'main');
    original.mountTMToProject(project, tm, 5, 'read');
    original.upsertTMEntry({
      id: 'entry',
      tmId: tm,
      projectId: project,
      srcLang: 'en',
      tgtLang: 'zh',
      srcHash: 'hash',
      matchKey: 'crystal orchard',
      tagsSignature: '',
      sourceTokens: [{ type: 'text', content: 'Crystal orchard' }],
      targetTokens: [{ type: 'text', content: '水晶果园' }],
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      usageCount: 0,
    });
    const tb = original.createTermBase('Mounted TB', 'en', 'zh');
    original.mountTermBaseToProject(project, tb);
    original.insertTBEntryIfAbsentBySrcTerm({
      id: 'term',
      tbId: tb,
      srcLang: 'en',
      srcTerm: 'orchard',
      tgtTerm: '果园',
    });
  });
  afterEach(() => {
    original.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('copies the selected project with complete mounted resources and no settings or unrelated projects', () => {
    const snapshot = exportCloudProject(source, project);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('test-private-key');
    expect(serialized).not.toContain('Unrelated private project');
    const target = join(directory, 'target.db');
    restoreCloudProject(target, snapshot.state, snapshot.resources);
    const copy = new CATDatabase(target);
    try {
      expect(copy.listProjects()).toHaveLength(1);
      expect(copy.getSetting('openai_api_key')).toBeUndefined();
      expect(copy.searchTMRecallCandidates(project, 'Crystal orchard')).toEqual(
        original.searchTMRecallCandidates(project, 'Crystal orchard'),
      );
      expect(copy.listProjectTermEntries(project)).toEqual(
        original.listProjectTermEntries(project),
      );
    } finally {
      copy.close();
    }
  });
  it('retains unconfirmed changes across reopen and preserves edits arriving during upload', () => {
    let outbox = new CloudSnapshotOutbox(source, project);
    expect(outbox.prepare('empty', 1)).toBeNull();
    original.updateProjectAISettings(project, 'first edit', '');
    const first = outbox.prepare('op1', 1);
    expect(first).not.toBeNull();
    original.updateProjectAISettings(project, 'second edit', '');
    expect(outbox.prepare('ignored', 1)).toBe(first);
    outbox.close();
    outbox = new CloudSnapshotOutbox(source, project);
    expect(outbox.status().pending).toBe(first);
    outbox.acknowledge('op1');
    const second = JSON.parse(outbox.prepare('op2', 2)!);
    expect(second.state.tables.projects[0].aiPrompt).toBe('second edit');
    outbox.acknowledge('op2');
    expect(outbox.prepare('op3', 3)).toBeNull();
    outbox.close();
  });
  it('rejects extra tables, unsafe paths and restoring into a populated database', () => {
    const snapshot = exportCloudProject(source, project);
    expect(() => restoreCloudProject(source, snapshot.state, snapshot.resources)).toThrow(
      'empty cache',
    );
    const unsafe = structuredClone(snapshot.state);
    unsafe.tables.files[0].name = '../outside.xlsx';
    expect(() =>
      restoreCloudProject(join(directory, 'unsafe.db'), unsafe, snapshot.resources),
    ).toThrow('Unsafe');
    const extra = structuredClone(snapshot.state);
    extra.tables.app_settings = [];
    expect(() =>
      restoreCloudProject(join(directory, 'extra.db'), extra, snapshot.resources),
    ).toThrow('tables');
  });
});
