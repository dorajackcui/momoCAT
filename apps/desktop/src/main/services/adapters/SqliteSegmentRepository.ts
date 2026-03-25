import { CATDatabase } from '@cat/db';
import type { QaIssue, Segment, SegmentStatus, Token } from '@cat/core/models';
import type { ProjectType } from '@cat/core/project';
import { SegmentRepository } from '../ports';

export class SqliteSegmentRepository implements SegmentRepository {
  constructor(private readonly db: CATDatabase) {}

  bulkInsertSegments(segments: Segment[]): void {
    this.db.bulkInsertSegments(segments);
  }

  getSegmentsPage(fileId: number, offset: number, limit: number): Segment[] {
    return this.db.getSegmentsPage(fileId, offset, limit);
  }

  getSegment(segmentId: string): Segment | undefined {
    return this.db.getSegment(segmentId);
  }

  getProjectIdByFileId(fileId: number): number | undefined {
    return this.db.getProjectIdByFileId(fileId);
  }

  getProjectTypeByFileId(fileId: number): ProjectType | undefined {
    return this.db.getProjectTypeByFileId(fileId);
  }

  getProjectSegmentsByHash(projectId: number, srcHash: string): Segment[] {
    return this.db.getProjectSegmentsByHash(projectId, srcHash);
  }

  updateSegmentTarget(segmentId: string, targetTokens: Token[], status: SegmentStatus): void {
    this.db.updateSegmentTarget(segmentId, targetTokens, status);
  }

  updateSegmentQaIssues(segmentId: string, qaIssues: QaIssue[]): void {
    this.db.updateSegmentQaIssues(segmentId, qaIssues);
  }
}
