import type { Segment } from '@cat/core/models';
import type { SegmentRepository } from '../../ports';

export type SegmentPredicate = (segment: Segment) => boolean;

export class SegmentPagingIterator {
  constructor(
    private readonly segmentRepo: SegmentRepository,
    private readonly pageSize: number,
  ) {}

  public countFileSegments(fileId: number): number {
    let count = 0;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const page = this.segmentRepo.getSegmentsPage(fileId, offset, this.pageSize);
      if (page.length === 0) {
        break;
      }
      count += page.length;
      hasMore = page.length === this.pageSize;
      offset += this.pageSize;
    }

    return count;
  }

  public countMatchingSegments(fileId: number, predicate: SegmentPredicate): number {
    let count = 0;
    for (const segment of this.iterateFileSegments(fileId)) {
      if (predicate(segment)) {
        count += 1;
      }
    }
    return count;
  }

  public *iterateFileSegments(fileId: number): Generator<Segment> {
    let offset = 0;

    while (true) {
      const page = this.segmentRepo.getSegmentsPage(fileId, offset, this.pageSize);
      if (page.length === 0) return;
      for (const segment of page) {
        yield segment;
      }
      if (page.length < this.pageSize) return;
      offset += this.pageSize;
    }
  }
}
