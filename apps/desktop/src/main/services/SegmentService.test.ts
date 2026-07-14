import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepeatPropagationState, Segment, SegmentStatus, Token } from '@cat/core/models';
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
    status: 'new',
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

  updateSegmentTarget(
    segmentId: string,
    targetTokens: Token[],
    status: SegmentStatus,
    repeatPropagation?: RepeatPropagationState | null,
  ): void {
    if (segmentId === this.failingSegmentId) {
      throw new Error('Propagation failed');
    }
    this.delegate.updateSegmentTarget(segmentId, targetTokens, status, repeatPropagation);
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

  updateSegmentTarget(
    segmentId: string,
    targetTokens: Token[],
    status: SegmentStatus,
    repeatPropagation?: RepeatPropagationState | null,
  ): void {
    const segment = this.segments.get(segmentId);
    if (!segment) return;
    const meta = { ...segment.meta };
    if (repeatPropagation !== undefined) {
      if (repeatPropagation) meta.repeatPropagation = repeatPropagation;
      else delete meta.repeatPropagation;
    }
    this.segments.set(segmentId, {
      ...segment,
      targetTokens,
      status,
      meta,
    });
  }

  updateSegmentQaIssues(): void {}
}

describe('SegmentService segment update events', () => {
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
    const result = await service.updateSegment('seg-1', targetTokens, 'translated');

    expect(result).toMatchObject({ fileId, propagatedIds: [] });
    expect(eventSpy).toHaveBeenCalledTimes(1);
    expect(eventSpy.mock.calls[0][0]).toMatchObject({
      fileId,
      segmentId: 'seg-1',
      status: 'translated',
    });
    expect(workingTMUpdatedSpy).not.toHaveBeenCalled();
  });

  it('keeps a manual edit to a later auto-followed repeat local', async () => {
    const fileId = 42;
    const srcHash = 'hash-repeated';
    const repo = new InMemorySegmentRepository([
      buildSegment('seg-1', fileId, 0, srcHash),
      buildSegment('seg-2', fileId, 1, srcHash),
    ]);
    const tx = { runInTransaction: <T>(fn: () => T) => fn() };
    const tmService = { upsertFromConfirmedSegment: vi.fn() } as unknown as TMService;
    const service = new SegmentService(repo, tmService, tx);
    const workingTMUpdatedSpy = vi.fn();
    service.on('working-tm-updated', workingTMUpdatedSpy);

    const initialTokens: Token[] = [{ type: 'text', content: 'initial' }];
    await service.updateSegment('seg-1', initialTokens, 'confirmed');

    expect(repo.getSegment('seg-1')?.meta.repeatPropagation).toEqual({ mode: 'leader' });
    expect(repo.getSegment('seg-2')?.meta.repeatPropagation).toEqual({
      mode: 'following',
      sourceSegmentId: 'seg-1',
    });

    const revisedTokens: Token[] = [{ type: 'text', content: 'local revision' }];
    const draftResult = await service.updateSegment('seg-2', revisedTokens, 'draft');
    const confirmedResult = await service.updateSegment('seg-2', revisedTokens, 'confirmed');

    expect(draftResult.propagatedIds).toEqual([]);
    expect(confirmedResult.propagatedIds).toEqual([]);
    expect(toText(repo.getSegment('seg-1')?.targetTokens ?? [])).toBe('initial');
    expect(toText(repo.getSegment('seg-2')?.targetTokens ?? [])).toBe('local revision');
    expect(repo.getSegment('seg-2')?.meta.repeatPropagation).toEqual({ mode: 'detached' });
    expect(workingTMUpdatedSpy).toHaveBeenLastCalledWith({ projectId: 1, srcHash });
  });

  it('updates following repeats but preserves a manually detached repeat', async () => {
    const fileId = 42;
    const srcHash = 'hash-contextual-repeat';
    const repo = new InMemorySegmentRepository([
      buildSegment('seg-1', fileId, 0, srcHash),
      buildSegment('seg-2', fileId, 1, srcHash),
      buildSegment('seg-3', fileId, 2, srcHash),
    ]);
    const tx = { runInTransaction: <T>(fn: () => T) => fn() };
    const tmService = { upsertFromConfirmedSegment: vi.fn() } as unknown as TMService;
    const service = new SegmentService(repo, tmService, tx);

    const initialTokens: Token[] = [{ type: 'text', content: 'shared translation' }];
    await service.updateSegment('seg-1', initialTokens, 'confirmed');

    const divergentTokens: Token[] = [{ type: 'text', content: 'context-specific translation' }];
    await service.updateSegment('seg-3', divergentTokens, 'draft');
    const divergentResult = await service.updateSegment('seg-3', divergentTokens, 'confirmed');

    expect(divergentResult.propagatedIds).toEqual([]);
    expect(repo.getSegment('seg-3')?.meta.repeatPropagation).toEqual({ mode: 'detached' });

    const revisedTokens: Token[] = [{ type: 'text', content: 'revised shared translation' }];
    const result = await service.updateSegment('seg-1', revisedTokens, 'confirmed');

    expect(result.propagatedIds).toEqual(['seg-2']);
    expect(toText(repo.getSegment('seg-2')?.targetTokens ?? [])).toBe('revised shared translation');
    expect(toText(repo.getSegment('seg-3')?.targetTokens ?? [])).toBe(
      'context-specific translation',
    );
  });

  it('does not let an unlinked later occurrence start a new propagation chain', async () => {
    const fileId = 42;
    const srcHash = 'hash-later-local';
    const repo = new InMemorySegmentRepository([
      buildSegment('seg-1', fileId, 0, srcHash),
      buildSegment('seg-2', fileId, 1, srcHash),
      buildSegment('seg-3', fileId, 2, srcHash),
    ]);
    const localTokens: Token[] = [{ type: 'text', content: 'local middle translation' }];
    repo.updateSegmentTarget('seg-2', localTokens, 'draft');

    const tx = { runInTransaction: <T>(fn: () => T) => fn() };
    const tmService = { upsertFromConfirmedSegment: vi.fn() } as unknown as TMService;
    const service = new SegmentService(repo, tmService, tx);

    const result = await service.updateSegment('seg-2', localTokens, 'confirmed');

    expect(result.propagatedIds).toEqual([]);
    expect(repo.getSegment('seg-2')?.meta.repeatPropagation).toEqual({ mode: 'detached' });
    expect(repo.getSegment('seg-1')?.status).toBe('new');
    expect(repo.getSegment('seg-3')?.status).toBe('new');
  });

  it('scopes repeat leadership and propagation to the current file', async () => {
    const srcHash = 'hash-cross-file-repeat';
    const repo = new InMemorySegmentRepository([
      buildSegment('file-a-seg', 1, 0, srcHash),
      buildSegment('file-b-seg-1', 2, 0, srcHash),
      buildSegment('file-b-seg-2', 2, 1, srcHash),
    ]);
    const tx = { runInTransaction: <T>(fn: () => T) => fn() };
    const tmService = { upsertFromConfirmedSegment: vi.fn() } as unknown as TMService;
    const service = new SegmentService(repo, tmService, tx);
    const targetTokens: Token[] = [{ type: 'text', content: 'current-file translation' }];

    const result = await service.updateSegment('file-b-seg-1', targetTokens, 'confirmed');

    expect(result.propagatedIds).toEqual(['file-b-seg-2']);
    expect(repo.getSegment('file-a-seg')?.status).toBe('new');
    expect(repo.getSegment('file-b-seg-1')?.meta.repeatPropagation).toEqual({ mode: 'leader' });
    expect(repo.getSegment('file-b-seg-2')?.meta.repeatPropagation).toEqual({
      mode: 'following',
      sourceSegmentId: 'file-b-seg-1',
    });
  });

  it('does not persist repeat metadata for a source that is unique in its file', async () => {
    const srcHash = 'hash-unique-in-file';
    const repo = new InMemorySegmentRepository([
      buildSegment('other-file-seg', 41, 0, srcHash),
      buildSegment('unique-seg', 42, 0, srcHash),
    ]);
    const tx = { runInTransaction: <T>(fn: () => T) => fn() };
    const tmService = { upsertFromConfirmedSegment: vi.fn() } as unknown as TMService;
    const service = new SegmentService(repo, tmService, tx);
    const targetTokens: Token[] = [{ type: 'text', content: 'unique translation' }];

    await service.updateSegment('unique-seg', targetTokens, 'draft');
    expect(repo.getSegment('unique-seg')?.meta.repeatPropagation).toBeUndefined();

    await service.updateSegment('unique-seg', targetTokens, 'confirmed');
    expect(repo.getSegment('unique-seg')?.meta.repeatPropagation).toBeUndefined();
    expect(repo.getSegment('other-file-seg')?.status).toBe('new');
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
    expect(repeated?.meta.repeatPropagation).toEqual({
      mode: 'following',
      sourceSegmentId: 'seg-1',
    });
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
    expect(source?.status).toBe('new');
    expect(source?.targetTokens).toEqual([]);
    expect(repeated?.status).toBe('new');
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
    expect(repeated?.status).toBe('new');
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
    expect(repeated?.status).toBe('new');
    expect(repeated?.targetTokens).toEqual([]);

    const mountedTMs = db.getProjectMountedTMs(projectId);
    expect(mountedTMs).toHaveLength(0);
  });
});
