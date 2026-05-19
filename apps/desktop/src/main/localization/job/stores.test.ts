import { mkdtemp, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { ArtifactStore } from './ArtifactStore';
import { CheckpointStore } from './CheckpointStore';
import { EventSink } from './EventSink';
import { appendJsonlRecord, readJsonlRecords } from './JsonlStore';
import type { ArtifactRecord, CheckpointRecord, JobUnit, ProgressEventRecord } from './types';

describe('JsonlStore', () => {
  it('reads a missing file as an empty record list', async () => {
    const dir = await makeTempDir();

    const result = await readJsonlRecords(join(dir, 'missing.jsonl'));

    expect(result.records).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('appends and reads JSONL records', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'nested', 'records.jsonl');

    await appendJsonlRecord(filePath, { id: 1, value: 'first' });
    await appendJsonlRecord(filePath, { id: 2, value: 'second' });

    const result = await readJsonlRecords(filePath);

    expect(result).toEqual({
      records: [
        { id: 1, value: 'first' },
        { id: 2, value: 'second' },
      ],
      diagnostics: [],
    });
  });

  it('keeps valid records when a JSONL line is invalid', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'records.jsonl');

    await appendJsonlRecord(filePath, { id: 1 });
    await appendJsonlRecord(filePath, { id: 2 });
    await import('fs/promises').then(({ appendFile }) =>
      appendFile(filePath, '{invalid-json}\n{"id":3}\n', 'utf8'),
    );

    const result = await readJsonlRecords(filePath);

    expect(result.records).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].line).toBe(3);
  });
});

describe('CheckpointStore', () => {
  it('uses the last valid checkpoint record per job, document, and unit', async () => {
    const dir = await makeTempDir();
    const store = new CheckpointStore(join(dir, 'checkpoint.jsonl'));
    const unit = makeUnit({ sourceHash: 'hash-2' });

    await store.append(makeCheckpoint({ hash: 'hash-1', target: 'old target' }));
    await store.append(makeCheckpoint({ hash: 'hash-2', target: 'new target', attempts: 2 }));

    const index = await store.load('job-1');

    expect(index.getReusableRecord(unit)?.target).toBe('new target');
    expect(index.toReusedResult(unit)).toMatchObject({
      jobId: 'job-1',
      documentId: 'doc-1',
      unitId: 'unit-1',
      sourceHash: 'hash-2',
      status: 'reused',
      target: 'new target',
      attempts: 2,
    });
    expect(index.isPending(unit)).toBe(false);
  });

  it('does not reuse a checkpoint record when the source hash changed', async () => {
    const dir = await makeTempDir();
    const store = new CheckpointStore(join(dir, 'checkpoint.jsonl'));

    await store.append(makeCheckpoint({ hash: 'old-hash', target: 'target' }));

    const index = await store.load('job-1');

    expect(index.getReusableRecord(makeUnit({ sourceHash: 'new-hash' }))).toBeUndefined();
    expect(index.isPending(makeUnit({ sourceHash: 'new-hash' }))).toBe(true);
  });

  it('treats failed checkpoint records as pending', async () => {
    const dir = await makeTempDir();
    const store = new CheckpointStore(join(dir, 'checkpoint.jsonl'));
    const unit = makeUnit({ sourceHash: 'hash-1' });

    await store.append(
      makeCheckpoint({
        status: 'failed',
        hash: 'hash-1',
        error: 'Provider failed',
      }),
    );

    const index = await store.load('job-1');

    expect(index.getReusableRecord(unit)).toBeUndefined();
    expect(index.isPending(unit)).toBe(true);
  });

  it('loads usable checkpoints around invalid JSON and invalid records', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'checkpoint.jsonl');
    const store = new CheckpointStore(filePath);
    const unit = makeUnit({ sourceHash: 'hash-1' });

    await appendJsonlRecord(filePath, makeCheckpoint({ target: 'target' }));
    await import('fs/promises').then(({ appendFile }) =>
      appendFile(filePath, '{invalid-json}\n{"job":"job-1","doc":"doc-1"}\n', 'utf8'),
    );

    const index = await store.load('job-1');

    expect(index.getReusableRecord(unit)?.target).toBe('target');
    expect(index.diagnostics).toHaveLength(2);
  });
});

describe('EventSink', () => {
  it('writes stdout output as one NDJSON line through an injected writer', async () => {
    const dir = await makeTempDir();
    const event = makeEvent();
    const stdoutLines: string[] = [];
    const sink = new EventSink(join(dir, 'events.jsonl'), {
      stdout: true,
      writeStdout: (line) => stdoutLines.push(line),
    });

    await sink.append(event);

    expect(stdoutLines).toEqual([`${JSON.stringify(event)}\n`]);
    expect(JSON.parse(stdoutLines[0])).toEqual(event);
    expect(stdoutLines[0].endsWith('\n')).toBe(true);
  });
});

describe('ArtifactStore', () => {
  it('appends artifact records', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'artifacts.jsonl');
    const store = new ArtifactStore(filePath);
    const artifact: ArtifactRecord = {
      job: 'job-1',
      task: 'task-1',
      doc: 'doc-1',
      unit: 'unit-1',
      metadata: { provider: 'test' },
      at: '2026-05-19T00:00:00.000Z',
    };

    await store.append(artifact);

    expect(await readFile(filePath, 'utf8')).toBe(`${JSON.stringify(artifact)}\n`);
  });
});

function makeCheckpoint(overrides: Partial<CheckpointRecord> = {}): CheckpointRecord {
  return {
    job: 'job-1',
    doc: 'doc-1',
    unit: 'unit-1',
    hash: 'hash-1',
    status: 'translated',
    target: 'translated target',
    attempts: 1,
    at: '2026-05-19T00:00:00.000Z',
    ...overrides,
  };
}

function makeEvent(overrides: Partial<ProgressEventRecord> = {}): ProgressEventRecord {
  return {
    job: 'job-1',
    event: 'unit_done',
    doc: 'doc-1',
    unit: 'unit-1',
    status: 'translated',
    done: 1,
    total: 1,
    at: '2026-05-19T00:00:00.000Z',
    ...overrides,
  };
}

function makeUnit(overrides: Partial<JobUnit> = {}): JobUnit {
  return {
    documentId: 'doc-1',
    unitId: 'unit-1',
    source: 'source',
    sourceHash: 'hash-1',
    ...overrides,
  };
}

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'momocat-job-stores-'));
}
