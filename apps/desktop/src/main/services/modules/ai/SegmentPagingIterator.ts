import type { Segment } from '@cat/core/models';
import type { SegmentRepository } from '../../ports';

export class SegmentPagingIterator {
  constructor(
    private readonly segmentRepo: SegmentRepository,
    private readonly pageSize: number,
  ) {}

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
