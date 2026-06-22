import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  JsonlTranslationAuditSink,
  createMemoryTranslationAuditSink,
  noopTranslationAuditSink,
  summarizeAuditText,
} from './TranslationAudit';

const repairRequestEvent = {
  event: 'mt_repair_request' as const,
  job: 'job-1',
  task: 'task-1',
  unit: 'row-20',
  rid: 'r4',
  reason: 'tag_invalid' as const,
};

describe('TranslationAudit', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
    tempDirs.length = 0;
  });

  it('allows recording to the noop sink', () => {
    expect(() => noopTranslationAuditSink.record(repairRequestEvent)).not.toThrow();
  });

  it('stores memory sink events in order', () => {
    const sink = createMemoryTranslationAuditSink();
    const secondEvent = {
      event: 'mt_repair_failed' as const,
      job: 'job-1',
      task: 'task-1',
      unit: 'row-20',
      rid: 'r4',
      message: 'still invalid',
    };

    sink.record(repairRequestEvent);
    sink.record(secondEvent);

    expect(sink.events).toEqual([repairRequestEvent, secondEvent]);
  });

  it('writes JSONL records after flush waits for queued writes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'translation-audit-'));
    tempDirs.push(dir);
    const sink = new JsonlTranslationAuditSink(join(dir, 'nested', 'audit.jsonl'), {
      now: () => new Date('2026-06-17T00:00:00.000Z'),
    });

    sink.record(repairRequestEvent);
    await sink.flush();

    const lines = (await readFile(join(dir, 'nested', 'audit.jsonl'), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      at: '2026-06-17T00:00:00.000Z',
      ...repairRequestEvent,
    });
  });

  it('serializes only whitelisted JSONL event fields', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'translation-audit-'));
    tempDirs.push(dir);
    const sink = new JsonlTranslationAuditSink(join(dir, 'audit.jsonl'), {
      now: () => new Date('2026-06-17T00:00:00.000Z'),
    });

    sink.record({ ...repairRequestEvent, targetText: 'do not write me' } as never);
    await sink.flush();

    const line = (await readFile(join(dir, 'audit.jsonl'), 'utf8')).trim();
    expect(JSON.parse(line)).toEqual({
      at: '2026-06-17T00:00:00.000Z',
      ...repairRequestEvent,
    });
  });

  it('reports one error and disables queued JSONL writes after filesystem failure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'translation-audit-'));
    tempDirs.push(dir);
    await writeFile(join(dir, 'blocked'), 'not a directory', 'utf8');
    const onError = vi.fn();
    const sink = new JsonlTranslationAuditSink(join(dir, 'blocked', 'audit.jsonl'), { onError });

    sink.record(repairRequestEvent);
    sink.record(repairRequestEvent);
    await sink.flush();

    expect(onError).toHaveBeenCalledTimes(1);

    sink.record(repairRequestEvent);
    await sink.flush();

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('summarizes target text with only a short hash and character count', () => {
    expect(summarizeAuditText('Bonjour {1}')).toEqual({
      targetHash: expect.stringMatching(/^[0-9a-f]{12}$/),
      targetChars: 11,
    });
  });
});
