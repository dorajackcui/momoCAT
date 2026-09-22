import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Segment, SegmentStatus, Token } from '@cat/core/models';
import { CATDatabase } from '../../../../../packages/db/src';
import { SegmentService } from './SegmentService';
import { TMService } from './TMService';
import { SqliteProjectRepository } from './adapters/SqliteProjectRepository';
import { SqliteSegmentRepository } from './adapters/SqliteSegmentRepository';
import { SqliteTMRepository } from './adapters/SqliteTMRepository';
import { SqliteTransactionManager } from './adapters/SqliteTransactionManager';
import { SegmentRepository } from './ports';

function buildSegment(
  segmentId: string,
  fileId: number,
  orderIndex: number,
  srcHash: string,
): Segment {
  return {
    segmentId,
    fileId,
    orderIndex,
    sourceTokens: [{ type: 'text', content: 'Hello' }],
    targetTokens: [],
    status: 'empty',
    tagsSignature: '',
    matchKey: 'hello',
    srcHash,
    meta: { updatedAt: new Date().toISOString() },
  };
}

function toText(tokens: Token[]): string {
  return tokens.map((token) => token.content).join('');
}

class FailingPropagationSegmentRepository implements SegmentRepository {
  constructor(
    private readonly delegate: SegmentRepository,
    private readonly failingSegmentId: string,
  ) {}

  bulkInsertSegments(segments: Segment[]): void {
    this.delegate.bulkInsertSegments(segments);
  }

  getSegmentsPage(fileId: number, offset: number, limit: number): Segment[] {
    return this.delegate.getSegmentsPage(fileId, offset, limit);
  }

  getSegment(segmentId: string): Segment | undefined {
    return this.delegate.getSegment(segmentId);
  }

  getProjectIdByFileId(fileId: number): number | undefined {
    return this.delegate.getProjectIdByFileId(fileId);
  }

  getProjectTypeByFileId(fileId: number) {
    return this.delegate.getProjectTypeByFileId(fileId);
  }

  getProjectSegmentsByHash(projectId: number, srcHash: string, fileId?: number): Segment[] {
    return this.delegate.getProjectSegmentsByHash(projectId, srcHash, fileId);
  }

  updateSegmentTarget(segmentId: string, targetTokens: Token[], status: SegmentStatus): void {
    if (segmentId === this.failingSegmentId) {
      throw new Error('Propagation failed');
    }
    this.delegate.updateSegmentTarget(segmentId, targetTokens, status);
  }
}

class InMemorySegmentRepository implements SegmentRepository {
  private readonly segments = new Map<string, Segment>();

  constructor(segments: Segment[]) {
    for (const segment of segments) {
      this.segments.set(segment.segmentId, segment);
    }
  }

  bulkInsertSegments(segments: Segment[]): void {
    for (const segment of segments) {
      this.segments.set(segment.segmentId, segment);
    }
  }

  getSegmentsPage(fileId: number, offset: number, limit: number): Segment[] {
    return [...this.segments.values()]
      .filter((segment) => segment.fileId === fileId)
      .sort((left, right) => left.orderIndex - right.orderIndex)
      .slice(offset, offset + limit);
  }

  getSegment(segmentId: string): Segment | undefined {
    return this.segments.get(segmentId);
  }

  getProjectIdByFileId(): number | undefined {
    return 1;
  }

  getProjectTypeByFileId(): 'translation' {
    return 'translation';
  }

  getProjectSegmentsByHash(_projectId: number, srcHash: string, fileId?: number): Segment[] {
    return [...this.segments.values()].filter(
      (segment) =>
        segment.srcHash === srcHash && (fileId === undefined || segment.fileId === fileId),
    );
  }

  updateSegmentTarget(segmentId: string, targetTokens: Token[], status: SegmentStatus): void {
    const segment = this.segments.get(segmentId);
    if (!segment) return;
    this.segments.set(segmentId, {
      ...segment,
      targetTokens,
      status,
    });
  }

  updateSegmentQaIssues(): void {}
}

describe('SegmentService segment update events', () => {
  it('normalizes saved status and emitted status together for single and atomic edits', async () => {
    const repo = new InMemorySegmentRepository([buildSegment('seg-1', 42, 0, 'hash-1')]);
    const service = new SegmentService(repo, {} as TMService, { runInTransaction: (fn) => fn() });
    const events = vi.fn();
    service.on('segments-updated', events);
    await service.updateSegment('seg-1', [{ type: 'text', content: 'Translation' }], 'empty');
    expect(repo.getSegment('seg-1')?.status).toBe('draft');
    expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'draft' }));
    await service.updateSegmentsAtomically([
      { segmentId: 'seg-1', targetTokens: [], status: 'draft' },
    ]);
    expect(repo.getSegment('seg-1')?.status).toBe('empty');
    expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'empty' }));
  });

  it('includes fileId in update results and emitted payloads', async () => {
    const fileId = 42;
    const repo = new InMemorySegmentRepository([buildSegment('seg-1', fileId, 0, 'hash-1')]);
    const tx = { runInTransaction: <T>(fn: () => T) => fn() };
    const tmService = { upsertFromConfirmedSegment: vi.fn() } as unknown as TMService;
    const service = new SegmentService(repo, tmService, tx);
    const eventSpy = vi.fn();
    const workingTMUpdatedSpy = vi.fn();
    service.on('segments-updated', eventSpy);
    service.on('working-tm-updated', workingTMUpdatedSpy);

    const targetTokens: Token[] = [{ type: 'text', content: 'translated' }];
    const result = await service.updateSegment('seg-1', targetTokens, 'draft');

    expect(result).toMatchObject({ fileId, propagatedIds: [] });
    expect(eventSpy).toHaveBeenCalledTimes(1);
    expect(eventSpy.mock.calls[0][0]).toMatchObject({
      fileId,
      segmentId: 'seg-1',
      status: 'draft',
    });
    expect(workingTMUpdatedSpy).not.toHaveBeenCalled();
  });
});

describe('SegmentService repeat propagation', () => {
  function setup(
    segments = [
      buildSegment('A', 42, 0, 'repeat'),
      buildSegment('B', 42, 1, 'repeat'),
      buildSegment('C', 42, 2, 'repeat'),
    ],
  ) {
    const repo = new InMemorySegmentRepository(segments);
    const tx = { runInTransaction: <T>(fn: () => T) => fn() };
    const tmService = { upsertFromConfirmedSegment: vi.fn() } as unknown as TMService;
    return { repo, service: new SegmentService(repo, tmService, tx) };
  }

  it.each(['empty', 'draft', 'confirmed'] as const)(
    'copies the first confirmation over all later %s targets',
    async (status) => {
      const { repo, service } = setup();
      for (const id of ['B', 'C']) {
        repo.updateSegmentTarget(
          id,
          status === 'empty' ? [] : [{ type: 'text', content: id }],
          status,
        );
      }
      const targetTokens: Token[] = [{ type: 'text', content: 'Shared translation' }];
      const result = await service.updateSegment('A', targetTokens, 'confirmed');
      expect(result.propagatedIds).toEqual(['B', 'C']);
      for (const id of ['A', 'B', 'C']) {
        expect(repo.getSegment(id)).toMatchObject({ targetTokens, status: 'confirmed' });
        expect(repo.getSegment(id)?.meta).not.toHaveProperty('repeatPropagation');
      }
    },
  );

  it.each(['draft', 'confirmed'] as const)(
    'keeps a later %s edit local until the first occurrence is confirmed again',
    async (status) => {
      const { repo, service } = setup();
      const initial: Token[] = [{ type: 'text', content: 'Initial' }];
      await service.updateSegment('A', initial, 'confirmed');
      const local: Token[] = [{ type: 'text', content: 'Only B' }];
      await service.updateSegment('B', local, 'draft');
      const localResult = await service.updateSegment('B', local, status);
      expect(localResult.propagatedIds).toEqual([]);
      expect(repo.getSegment('A')?.targetTokens).toEqual(initial);
      expect(repo.getSegment('C')?.targetTokens).toEqual(initial);

      const revised: Token[] = [{ type: 'text', content: 'Revised A' }];
      await service.updateSegment('A', revised, 'draft');
      expect(repo.getSegment('B')?.targetTokens).toEqual(local);
      expect(repo.getSegment('C')?.targetTokens).toEqual(initial);
      const result = await service.updateSegment('A', revised, 'confirmed');
      expect(result.propagatedIds).toEqual(['B', 'C']);
      for (const id of ['B', 'C']) {
        expect(repo.getSegment(id)).toMatchObject({ targetTokens: revised, status: 'confirmed' });
      }
    },
  );

  it('never propagates from a later occurrence, regardless of repository result order', async () => {
    const { repo, service } = setup([
      buildSegment('B', 42, 1, 'repeat'),
      buildSegment('C', 42, 2, 'repeat'),
      buildSegment('A', 42, 0, 'repeat'),
    ]);
    const targetTokens: Token[] = [{ type: 'text', content: 'Local translation' }];
    const result = await service.updateSegment('B', targetTokens, 'confirmed');
    expect(result.propagatedIds).toEqual([]);
    expect(repo.getSegment('A')?.status).toBe('empty');
    expect(repo.getSegment('C')?.status).toBe('empty');
    expect((await service.updateSegment('A', targetTokens, 'confirmed')).propagatedIds).toEqual([
      'C',
    ]);
    expect(repo.getSegment('C')?.targetTokens).toEqual(targetTokens);
  });

  it('does not query repeats during draft saves and queries the group only once on confirmation', async () => {
    const { repo, service } = setup();
    const query = vi.spyOn(repo, 'getProjectSegmentsByHash');
    const targetTokens: Token[] = [{ type: 'text', content: 'Draft' }];
    await service.updateSegment('A', targetTokens, 'draft');
    await service.updateSegment('B', targetTokens, 'draft');
    await service.updateSegment('C', [], 'empty');
    expect(query).not.toHaveBeenCalled();
    await service.confirmSegment('A');
    expect(query).toHaveBeenCalledExactlyOnceWith(1, 'repeat', 42);
  });

  it('ignores legacy detached metadata when confirming the first occurrence', async () => {
    const legacy = buildSegment('B', 42, 1, 'repeat');
    const meta = {
      ...legacy.meta,
      context: 'Keep context',
      repeatPropagation: { mode: 'detached' },
    };
    legacy.meta = meta;
    const { repo, service } = setup([buildSegment('A', 42, 0, 'repeat'), legacy]);
    const targetTokens: Token[] = [{ type: 'text', content: 'Updated translation' }];
    expect((await service.updateSegment('A', targetTokens, 'confirmed')).propagatedIds).toEqual([
      'B',
    ]);
    expect(repo.getSegment('B')).toMatchObject({ targetTokens, status: 'confirmed', meta });
  });

  it('scopes propagation to the same source in the same file', async () => {
    const { repo, service } = setup([
      buildSegment('other-file', 41, 0, 'repeat'),
      buildSegment('A', 42, 0, 'repeat'),
      buildSegment('B', 42, 1, 'repeat'),
      buildSegment('other-source', 42, 2, 'different'),
    ]);
    const targetTokens: Token[] = [{ type: 'text', content: 'Current file' }];
    expect((await service.updateSegment('A', targetTokens, 'confirmed')).propagatedIds).toEqual([
      'B',
    ]);
    expect(repo.getSegment('other-file')?.targetTokens).toEqual([]);
    expect(repo.getSegment('other-source')?.targetTokens).toEqual([]);
  });

  it('avoids rewriting repeats that are already confirmed with the same target', async () => {
    const { repo, service } = setup();
    const targetTokens: Token[] = [{ type: 'text', content: 'Already shared' }];
    await service.updateSegment('A', targetTokens, 'confirmed');
    const write = vi.spyOn(repo, 'updateSegmentTarget');
    expect((await service.updateSegment('A', targetTokens, 'confirmed')).propagatedIds).toEqual([]);
    expect(write).toHaveBeenCalledExactlyOnceWith('A', targetTokens, 'confirmed');
  });

  it('allows file commit workflows to confirm without propagating', async () => {
    const { repo, service } = setup();
    const query = vi.spyOn(repo, 'getProjectSegmentsByHash');
    await service.updateSegmentsAtomically(
      [{ segmentId: 'A', targetTokens: [{ type: 'text', content: 'Commit' }], status: 'confirmed' }],
      {
        propagateRepeats: false,
      },
    );
    expect(query).not.toHaveBeenCalled();
    expect(repo.getSegment('B')?.status).toBe('empty');
    expect(repo.getSegment('C')?.status).toBe('empty');
  });

  it('undoes the last propagation while preserving the first occurrence', async () => {
    const { repo, service } = setup();
    const initial: Token[] = [{ type: 'text', content: 'Initial' }];
    await service.updateSegment('A', initial, 'confirmed');
    const local: Token[] = [{ type: 'text', content: 'Local B' }];
    await service.updateSegment('B', local, 'draft');
    const revised: Token[] = [{ type: 'text', content: 'Revised' }];
    await service.updateSegment('A', revised, 'confirmed');
    await service.undoLastPropagation();
    expect(repo.getSegment('A')).toMatchObject({ targetTokens: revised, status: 'confirmed' });
    expect(repo.getSegment('B')).toMatchObject({ targetTokens: local, status: 'draft' });
    expect(repo.getSegment('C')).toMatchObject({ targetTokens: initial, status: 'confirmed' });
  });
});

describe('SegmentService transactional confirmation flow', () => {
  let db: CATDatabase | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it('commits segment confirm + TM upsert + propagation in one transaction', async () => {
    db = new CATDatabase(':memory:');
    const projectId = db.createProject('Tx Success', 'en', 'zh');
    const fileId = db.createFile(projectId, 'a.xlsx');
    const srcHash = 'hash-hello';

    db.bulkInsertSegments([
      buildSegment('seg-1', fileId, 0, srcHash),
      buildSegment('seg-2', fileId, 1, srcHash),
    ]);

    const projectRepo = new SqliteProjectRepository(db);
    const segmentRepo = new SqliteSegmentRepository(db);
    const tmRepo = new SqliteTMRepository(db);
    const tx = new SqliteTransactionManager(db);
    const tmService = new TMService(projectRepo, tmRepo);
    const service = new SegmentService(segmentRepo, tmService, tx);

    const eventSpy = vi.fn();
    const workingTMUpdatedSpy = vi.fn();
    service.on('segments-updated', eventSpy);
    service.on('working-tm-updated', workingTMUpdatedSpy);

    const targetTokens: Token[] = [{ type: 'text', content: '你好' }];
    const result = await service.updateSegment('seg-1', targetTokens, 'confirmed');

    expect(result.propagatedIds).toEqual(['seg-2']);

    const source = db.getSegment('seg-1');
    const repeated = db.getSegment('seg-2');
    expect(source?.status).toBe('confirmed');
    expect(toText(source?.targetTokens ?? [])).toBe('你好');
    expect(repeated?.status).toBe('confirmed');
    expect(repeated?.meta).not.toHaveProperty('repeatPropagation');
    expect(toText(repeated?.targetTokens ?? [])).toBe('你好');

    const workingTM = db.getProjectMountedTMs(projectId).find((tm) => tm.type === 'working');
    expect(workingTM).toBeDefined();
    if (!workingTM) {
      throw new Error('Expected working TM to exist');
    }
    const tmEntry = db.findTMEntryByHash(workingTM.id, srcHash);
    expect(tmEntry).toBeDefined();
    expect(toText(tmEntry?.targetTokens ?? [])).toBe('你好');

    expect(eventSpy).toHaveBeenCalledTimes(1);
    expect(eventSpy.mock.calls[0][0]).toMatchObject({
      segmentId: 'seg-1',
      status: 'confirmed',
      propagatedIds: ['seg-2'],
    });
    expect(workingTMUpdatedSpy).toHaveBeenCalledOnce();
    expect(workingTMUpdatedSpy).toHaveBeenCalledWith({ projectId, srcHash });
  });

  it('rolls back all writes when confirmation fails mid-transaction', async () => {
    db = new CATDatabase(':memory:');
    const projectId = db.createProject('Tx Rollback', 'en', 'zh');
    const fileId = db.createFile(projectId, 'b.xlsx');
    const srcHash = 'hash-hello';

    db.bulkInsertSegments([
      buildSegment('seg-1', fileId, 0, srcHash),
      buildSegment('seg-2', fileId, 1, srcHash),
    ]);

    const projectRepo = new SqliteProjectRepository(db);
    const segmentRepo = new SqliteSegmentRepository(db);
    const tmRepo = new SqliteTMRepository(db);
    const tx = new SqliteTransactionManager(db);
    const tmService = new TMService(projectRepo, tmRepo);
    const failingRepo = new FailingPropagationSegmentRepository(segmentRepo, 'seg-2');
    const service = new SegmentService(failingRepo, tmService, tx);

    const eventSpy = vi.fn();
    const workingTMUpdatedSpy = vi.fn();
    service.on('segments-updated', eventSpy);
    service.on('working-tm-updated', workingTMUpdatedSpy);

    const targetTokens: Token[] = [{ type: 'text', content: '你好' }];
    await expect(service.updateSegment('seg-1', targetTokens, 'confirmed')).rejects.toThrow(
      'Propagation failed',
    );

    const source = db.getSegment('seg-1');
    const repeated = db.getSegment('seg-2');
    expect(source?.status).toBe('empty');
    expect(source?.targetTokens).toEqual([]);
    expect(repeated?.status).toBe('empty');
    expect(repeated?.targetTokens).toEqual([]);
    expect(db.getFile(fileId)?.confirmedSegments).toBe(0);

    const workingTM = db.getProjectMountedTMs(projectId).find((tm) => tm.type === 'working');
    expect(workingTM).toBeDefined();
    if (!workingTM) {
      throw new Error('Expected working TM to exist');
    }
    const tmEntry = db.findTMEntryByHash(workingTM.id, srcHash);
    expect(tmEntry).toBeUndefined();

    expect(eventSpy).not.toHaveBeenCalled();
    expect(workingTMUpdatedSpy).not.toHaveBeenCalled();
  });

  it('does not upsert TM or propagate on confirm for review projects', async () => {
    db = new CATDatabase(':memory:');
    const projectId = db.createProject('Review Tx', 'en', 'zh', 'review');
    const fileId = db.createFile(projectId, 'review.xlsx');
    const srcHash = 'hash-review';

    db.bulkInsertSegments([
      buildSegment('seg-1', fileId, 0, srcHash),
      buildSegment('seg-2', fileId, 1, srcHash),
    ]);

    const projectRepo = new SqliteProjectRepository(db);
    const segmentRepo = new SqliteSegmentRepository(db);
    const tmRepo = new SqliteTMRepository(db);
    const tx = new SqliteTransactionManager(db);
    const tmService = new TMService(projectRepo, tmRepo);
    const service = new SegmentService(segmentRepo, tmService, tx);

    const targetTokens: Token[] = [{ type: 'text', content: '审校后文本' }];
    const result = await service.updateSegment('seg-1', targetTokens, 'confirmed');
    expect(result.propagatedIds).toEqual([]);

    const source = db.getSegment('seg-1');
    const repeated = db.getSegment('seg-2');
    expect(source?.status).toBe('confirmed');
    expect(toText(source?.targetTokens ?? [])).toBe('审校后文本');
    expect(repeated?.status).toBe('empty');
    expect(repeated?.targetTokens).toEqual([]);

    const mountedTMs = db.getProjectMountedTMs(projectId);
    expect(mountedTMs).toHaveLength(0);
  });

  it('does not upsert TM or propagate on confirm for custom projects', async () => {
    db = new CATDatabase(':memory:');
    const projectId = db.createProject('Custom Tx', 'en', 'zh', 'custom');
    const fileId = db.createFile(projectId, 'custom.xlsx');
    const srcHash = 'hash-custom';

    db.bulkInsertSegments([
      buildSegment('seg-1', fileId, 0, srcHash),
      buildSegment('seg-2', fileId, 1, srcHash),
    ]);

    const projectRepo = new SqliteProjectRepository(db);
    const segmentRepo = new SqliteSegmentRepository(db);
    const tmRepo = new SqliteTMRepository(db);
    const tx = new SqliteTransactionManager(db);
    const tmService = new TMService(projectRepo, tmRepo);
    const service = new SegmentService(segmentRepo, tmService, tx);

    const targetTokens: Token[] = [{ type: 'text', content: 'processed text' }];
    const result = await service.updateSegment('seg-1', targetTokens, 'confirmed');
    expect(result.propagatedIds).toEqual([]);

    const source = db.getSegment('seg-1');
    const repeated = db.getSegment('seg-2');
    expect(source?.status).toBe('confirmed');
    expect(toText(source?.targetTokens ?? [])).toBe('processed text');
    expect(repeated?.status).toBe('empty');
    expect(repeated?.targetTokens).toEqual([]);

    const mountedTMs = db.getProjectMountedTMs(projectId);
    expect(mountedTMs).toHaveLength(0);
  });
});
