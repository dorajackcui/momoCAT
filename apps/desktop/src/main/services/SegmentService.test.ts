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

  getProjectSegmentsByHash(projectId: number, srcHash: string): Segment[] {
    return this.delegate.getProjectSegmentsByHash(projectId, srcHash);
  }

  updateSegmentTarget(segmentId: string, targetTokens: Token[], status: SegmentStatus): void {
    if (segmentId === this.failingSegmentId && status === 'draft') {
      throw new Error('Propagation failed');
    }
    this.delegate.updateSegmentTarget(segmentId, targetTokens, status);
  }
}

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
    service.on('segments-updated', eventSpy);

    const targetTokens: Token[] = [{ type: 'text', content: '你好' }];
    const result = await service.updateSegment('seg-1', targetTokens, 'confirmed');

    expect(result.propagatedIds).toEqual(['seg-2']);

    const source = db.getSegment('seg-1');
    const repeated = db.getSegment('seg-2');
    expect(source?.status).toBe('confirmed');
    expect(toText(source?.targetTokens ?? [])).toBe('你好');
    expect(repeated?.status).toBe('draft');
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
    service.on('segments-updated', eventSpy);

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

    const workingTM = db.getProjectMountedTMs(projectId).find((tm) => tm.type === 'working');
    expect(workingTM).toBeDefined();
    if (!workingTM) {
      throw new Error('Expected working TM to exist');
    }
    const tmEntry = db.findTMEntryByHash(workingTM.id, srcHash);
    expect(tmEntry).toBeUndefined();

    expect(eventSpy).not.toHaveBeenCalled();
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
