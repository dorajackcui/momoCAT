import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Segment, Token } from '@cat/core/models';
import { TMModule } from './TMModule';
import { ProjectRepository, SegmentRepository, TMRepository, TransactionManager } from '../ports';
import { TMService } from '../TMService';
import { SegmentService } from '../SegmentService';
import { CATDatabase } from '../../../../../../packages/db/src';
import { SqliteProjectRepository } from '../adapters/SqliteProjectRepository';
import { SqliteSegmentRepository } from '../adapters/SqliteSegmentRepository';
import { SqliteTMRepository } from '../adapters/SqliteTMRepository';
import { SqliteTransactionManager } from '../adapters/SqliteTransactionManager';

function createSegment(segmentId: string, srcHash: string, status: Segment['status']): Segment {
  return {
    segmentId,
    fileId: 1,
    orderIndex: 0,
    sourceTokens: [{ type: 'text', content: 'Hello' }],
    targetTokens: [],
    status,
    tagsSignature: '',
    matchKey: 'hello',
    srcHash,
    meta: {
      updatedAt: new Date().toISOString(),
    },
  };
}

class FailingSegmentRepository implements SegmentRepository {
  constructor(
    private readonly delegate: SegmentRepository,
    private readonly shouldFail: (segmentId: string, status: Segment['status']) => boolean,
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

  updateSegmentTarget(segmentId: string, targetTokens: Token[], status: Segment['status']): void {
    if (this.shouldFail(segmentId, status)) {
      throw new Error('Forced segment update failure');
    }
    this.delegate.updateSegmentTarget(segmentId, targetTokens, status);
  }
}

describe('TMModule.batchMatchFileWithTM', () => {
  let db: CATDatabase | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it('uses segment confirmation flow instead of directly writing segment repository', async () => {
    const matchedTokens: Token[] = [{ type: 'text', content: '你好' }];
    const segments = [
      createSegment('seg-1', 'hash-1', 'new'),
      createSegment('seg-2', 'hash-2', 'confirmed'),
      createSegment('seg-3', 'hash-3', 'new'),
    ];

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 1, name: 'demo.xlsx' }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegmentsPage: vi.fn().mockReturnValue(segments),
      updateSegmentTarget: vi.fn(),
    } as unknown as SegmentRepository;

    const tmRepo = {
      getTM: vi.fn().mockReturnValue({ id: 'tm-1', srcLang: 'en', tgtLang: 'zh' }),
      getProjectMountedTMs: vi.fn().mockReturnValue([{ id: 'tm-1' }]),
      findTMEntryByHash: vi.fn((_: string, srcHash: string) => {
        if (srcHash === 'hash-1' || srcHash === 'hash-2') {
          return { targetTokens: matchedTokens };
        }
        return undefined;
      }),
    } as unknown as TMRepository;

    const tx = {
      runInTransaction: <T>(fn: () => T) => fn(),
    } as TransactionManager;

    const segmentService = {
      updateSegmentsAtomically: vi.fn().mockResolvedValue([]),
    } as unknown as SegmentService;

    const module = new TMModule(
      projectRepo,
      segmentRepo,
      tmRepo,
      tx,
      {} as TMService,
      segmentService,
      ':memory:',
      vi.fn(),
    );

    const result = await module.batchMatchFileWithTM(1, 'tm-1');

    expect(result).toEqual({
      total: 3,
      matched: 2,
      applied: 1,
      skipped: 1,
    });

    expect(segmentService.updateSegmentsAtomically).toHaveBeenCalledTimes(1);
    expect(segmentService.updateSegmentsAtomically).toHaveBeenCalledWith([
      { segmentId: 'seg-1', targetTokens: matchedTokens, status: 'confirmed' },
    ]);
    expect(segmentRepo.updateSegmentTarget).not.toHaveBeenCalled();
  });

  it('rejects when TM is not mounted to the target project', async () => {
    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 1, name: 'demo.xlsx' }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegmentsPage: vi.fn(),
    } as unknown as SegmentRepository;

    const tmRepo = {
      getTM: vi.fn().mockReturnValue({ id: 'tm-main', srcLang: 'en', tgtLang: 'zh' }),
      getProjectMountedTMs: vi.fn().mockReturnValue([]),
    } as unknown as TMRepository;

    const tx = {
      runInTransaction: <T>(fn: () => T) => fn(),
    } as TransactionManager;

    const segmentService = {
      updateSegmentsAtomically: vi.fn(),
    } as unknown as SegmentService;

    const module = new TMModule(
      projectRepo,
      segmentRepo,
      tmRepo,
      tx,
      {} as TMService,
      segmentService,
      ':memory:',
      vi.fn(),
    );

    await expect(module.batchMatchFileWithTM(1, 'tm-main')).rejects.toThrow(
      'TM is not mounted to this file project',
    );
    expect(segmentRepo.getSegmentsPage).not.toHaveBeenCalled();
    expect(segmentService.updateSegmentsAtomically).not.toHaveBeenCalled();
  });

  it('scans segments page by page for large files', async () => {
    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 1, name: 'large.xlsx' }),
    } as unknown as ProjectRepository;

    const firstPage: Segment[] = Array.from({ length: 2000 }, (_, index) =>
      createSegment(`seg-${index}`, index === 0 ? 'hash-first' : `hash-${index}`, 'new'),
    );
    const secondPage: Segment[] = [
      createSegment('seg-last', 'hash-last', 'new'),
      createSegment('seg-confirmed', 'hash-confirmed', 'confirmed'),
    ];

    const segmentRepo = {
      getSegmentsPage: vi.fn((fileId: number, offset: number, limit: number) => {
        if (fileId !== 1) return [];
        if (offset === 0) {
          expect(limit).toBe(2000);
          return firstPage;
        }
        if (offset === limit) {
          return secondPage;
        }
        return [];
      }),
    } as unknown as SegmentRepository;

    const matchedTokens: Token[] = [{ type: 'text', content: '匹配结果' }];
    const tmRepo = {
      getTM: vi.fn().mockReturnValue({ id: 'tm-large', srcLang: 'en', tgtLang: 'zh' }),
      getProjectMountedTMs: vi.fn().mockReturnValue([{ id: 'tm-large' }]),
      findTMEntryByHash: vi.fn((_: string, srcHash: string) => {
        if (srcHash === 'hash-first' || srcHash === 'hash-last' || srcHash === 'hash-confirmed') {
          return { targetTokens: matchedTokens };
        }
        return undefined;
      }),
    } as unknown as TMRepository;

    const tx = {
      runInTransaction: <T>(fn: () => T) => fn(),
    } as TransactionManager;

    const segmentService = {
      updateSegmentsAtomically: vi.fn().mockResolvedValue([]),
    } as unknown as SegmentService;

    const module = new TMModule(
      projectRepo,
      segmentRepo,
      tmRepo,
      tx,
      {} as TMService,
      segmentService,
      ':memory:',
      vi.fn(),
    );

    const result = await module.batchMatchFileWithTM(1, 'tm-large');

    expect(result).toEqual({
      total: 2002,
      matched: 3,
      applied: 2,
      skipped: 1,
    });

    expect(segmentRepo.getSegmentsPage).toHaveBeenCalledTimes(2);
    expect(segmentService.updateSegmentsAtomically).toHaveBeenCalledWith([
      { segmentId: 'seg-0', targetTokens: matchedTokens, status: 'confirmed' },
      { segmentId: 'seg-last', targetTokens: matchedTokens, status: 'confirmed' },
    ]);
  });

  it('keeps propagation, Working TM updates, and events consistent with manual confirmations', async () => {
    db = new CATDatabase(':memory:');
    const projectId = db.createProject('Batch Match', 'en', 'zh');
    const fileId = db.createFile(projectId, 'batch.xlsx');
    const srcHash = 'hash-hello';

    const segments: Segment[] = [
      createSegment('seg-1', srcHash, 'new'),
      createSegment('seg-2', srcHash, 'new'),
      createSegment('seg-3', 'hash-miss', 'new'),
    ].map((segment, index) => ({ ...segment, fileId, orderIndex: index }));

    db.bulkInsertSegments(segments);

    const mainTmId = db.createTM('Main TM', 'en', 'zh', 'main');
    db.mountTMToProject(projectId, mainTmId, 10, 'read');

    const matchedTokens: Token[] = [{ type: 'text', content: '你好' }];
    const now = new Date().toISOString();
    const entryId = db.upsertTMEntryBySrcHash({
      id: 'main-entry-1',
      tmId: mainTmId,
      projectId: 0,
      srcLang: 'en',
      tgtLang: 'zh',
      srcHash,
      matchKey: 'hello',
      tagsSignature: '',
      sourceTokens: [{ type: 'text', content: 'Hello' }],
      targetTokens: matchedTokens,
      createdAt: now,
      updatedAt: now,
      usageCount: 1,
    });
    db.replaceTMFts(mainTmId, 'Hello', '你好', entryId);

    const projectRepo = new SqliteProjectRepository(db);
    const segmentRepo = new SqliteSegmentRepository(db);
    const tmRepo = new SqliteTMRepository(db);
    const tx = new SqliteTransactionManager(db);
    const tmService = new TMService(projectRepo, tmRepo);
    const segmentService = new SegmentService(segmentRepo, tmService, tx);
    const module = new TMModule(
      projectRepo,
      segmentRepo,
      tmRepo,
      tx,
      tmService,
      segmentService,
      ':memory:',
      vi.fn(),
    );

    const eventSpy = vi.fn();
    segmentService.on('segments-updated', eventSpy);

    const result = await module.batchMatchFileWithTM(fileId, mainTmId);

    expect(result).toEqual({
      total: 3,
      matched: 2,
      applied: 2,
      skipped: 0,
    });

    const seg1 = db.getSegment('seg-1');
    const seg2 = db.getSegment('seg-2');
    const seg3 = db.getSegment('seg-3');
    expect(seg1?.status).toBe('confirmed');
    expect(seg2?.status).toBe('confirmed');
    expect(seg3?.status).toBe('new');
    expect(seg1?.targetTokens).toEqual(matchedTokens);
    expect(seg2?.targetTokens).toEqual(matchedTokens);

    const workingTM = db.getProjectMountedTMs(projectId).find((tm) => tm.type === 'working');
    expect(workingTM).toBeDefined();
    if (!workingTM) {
      throw new Error('Expected working TM to exist');
    }
    const workingEntry = db.findTMEntryByHash(workingTM.id, srcHash);
    expect(workingEntry?.targetTokens).toEqual(matchedTokens);

    expect(eventSpy).toHaveBeenCalledTimes(2);
    const firstEvent = eventSpy.mock.calls[0][0];
    const secondEvent = eventSpy.mock.calls[1][0];
    expect(firstEvent).toMatchObject({
      segmentId: 'seg-1',
      status: 'confirmed',
      propagatedIds: ['seg-2'],
    });
    expect(secondEvent).toMatchObject({
      segmentId: 'seg-2',
      status: 'confirmed',
      propagatedIds: [],
    });
  });

  it('rolls back all matched updates when one segment confirmation fails', async () => {
    db = new CATDatabase(':memory:');
    const projectId = db.createProject('Batch Atomic Rollback', 'en', 'zh');
    const fileId = db.createFile(projectId, 'atomic.xlsx');

    const segments: Segment[] = [
      createSegment('seg-1', 'hash-1', 'new'),
      createSegment('seg-2', 'hash-2', 'new'),
    ].map((segment, index) => ({ ...segment, fileId, orderIndex: index }));
    db.bulkInsertSegments(segments);

    const mainTmId = db.createTM('Main TM', 'en', 'zh', 'main');
    db.mountTMToProject(projectId, mainTmId, 10, 'read');

    const now = new Date().toISOString();
    const entryId1 = db.upsertTMEntryBySrcHash({
      id: 'main-entry-1',
      tmId: mainTmId,
      projectId: 0,
      srcLang: 'en',
      tgtLang: 'zh',
      srcHash: 'hash-1',
      matchKey: 'hello-1',
      tagsSignature: '',
      sourceTokens: [{ type: 'text', content: 'Hello 1' }],
      targetTokens: [{ type: 'text', content: '你好 1' }],
      createdAt: now,
      updatedAt: now,
      usageCount: 1,
    });
    db.replaceTMFts(mainTmId, 'Hello 1', '你好 1', entryId1);

    const entryId2 = db.upsertTMEntryBySrcHash({
      id: 'main-entry-2',
      tmId: mainTmId,
      projectId: 0,
      srcLang: 'en',
      tgtLang: 'zh',
      srcHash: 'hash-2',
      matchKey: 'hello-2',
      tagsSignature: '',
      sourceTokens: [{ type: 'text', content: 'Hello 2' }],
      targetTokens: [{ type: 'text', content: '你好 2' }],
      createdAt: now,
      updatedAt: now,
      usageCount: 1,
    });
    db.replaceTMFts(mainTmId, 'Hello 2', '你好 2', entryId2);

    const projectRepo = new SqliteProjectRepository(db);
    const baseSegmentRepo = new SqliteSegmentRepository(db);
    const failingSegmentRepo = new FailingSegmentRepository(
      baseSegmentRepo,
      (segmentId, status) => segmentId === 'seg-2' && status === 'confirmed',
    );
    const tmRepo = new SqliteTMRepository(db);
    const tx = new SqliteTransactionManager(db);
    const tmService = new TMService(projectRepo, tmRepo);
    const segmentService = new SegmentService(failingSegmentRepo, tmService, tx);
    const module = new TMModule(
      projectRepo,
      baseSegmentRepo,
      tmRepo,
      tx,
      tmService,
      segmentService,
      ':memory:',
      vi.fn(),
    );

    const eventSpy = vi.fn();
    segmentService.on('segments-updated', eventSpy);

    await expect(module.batchMatchFileWithTM(fileId, mainTmId)).rejects.toThrow(
      'Forced segment update failure',
    );

    const seg1 = db.getSegment('seg-1');
    const seg2 = db.getSegment('seg-2');
    expect(seg1?.status).toBe('new');
    expect(seg2?.status).toBe('new');
    expect(seg1?.targetTokens).toEqual([]);
    expect(seg2?.targetTokens).toEqual([]);

    const workingTM = db.getProjectMountedTMs(projectId).find((tm) => tm.type === 'working');
    expect(workingTM).toBeDefined();
    if (!workingTM) {
      throw new Error('Expected working TM to exist');
    }
    expect(db.findTMEntryByHash(workingTM.id, 'hash-1')).toBeUndefined();
    expect(db.findTMEntryByHash(workingTM.id, 'hash-2')).toBeUndefined();

    expect(eventSpy).not.toHaveBeenCalled();
  });
});
