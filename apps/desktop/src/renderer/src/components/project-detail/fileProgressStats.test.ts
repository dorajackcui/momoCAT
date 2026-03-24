import { describe, expect, it } from 'vitest';
import { deriveFileProgressBuckets, toPercent } from './fileProgressStats';

describe('fileProgressStats', () => {
  it('derives expected buckets and percentages for mixed status segments', () => {
    const buckets = deriveFileProgressBuckets({
      id: 1,
      uuid: 'file-1',
      projectId: 1,
      name: 'mixed.xlsx',
      totalSegments: 10,
      confirmedSegments: 4,
      createdAt: '',
      updatedAt: '',
      segmentStatusStats: {
        totalSegments: 10,
        qaProblemSegments: 2,
        confirmedSegmentsForBar: 3,
        inProgressSegments: 4,
        newSegments: 1,
      },
    });

    expect(buckets).toEqual({
      totalSegments: 10,
      qaProblemSegments: 2,
      confirmedSegmentsForBar: 3,
      inProgressSegments: 4,
      newSegments: 1,
    });

    expect(toPercent(buckets)).toEqual({
      qaProblemPct: 20,
      confirmedPct: 30,
      inProgressPct: 40,
      newPct: 10,
      confirmedDisplayPct: 30,
    });
  });

  it('keeps full bar as new when all segments are new', () => {
    const buckets = deriveFileProgressBuckets({
      id: 2,
      uuid: 'file-2',
      projectId: 1,
      name: 'all-new.xlsx',
      totalSegments: 5,
      confirmedSegments: 0,
      createdAt: '',
      updatedAt: '',
      segmentStatusStats: {
        totalSegments: 5,
        qaProblemSegments: 0,
        confirmedSegmentsForBar: 0,
        inProgressSegments: 0,
        newSegments: 5,
      },
    });

    expect(buckets.newSegments).toBe(5);
    expect(toPercent(buckets)).toMatchObject({
      qaProblemPct: 0,
      confirmedPct: 0,
      inProgressPct: 0,
      newPct: 100,
    });
  });

  it('maps full bar to red when all segments have QA issues', () => {
    const buckets = deriveFileProgressBuckets({
      id: 3,
      uuid: 'file-3',
      projectId: 1,
      name: 'all-qa.xlsx',
      totalSegments: 4,
      confirmedSegments: 4,
      createdAt: '',
      updatedAt: '',
      segmentStatusStats: {
        totalSegments: 4,
        qaProblemSegments: 4,
        confirmedSegmentsForBar: 0,
        inProgressSegments: 0,
        newSegments: 0,
      },
    });

    expect(toPercent(buckets)).toMatchObject({
      qaProblemPct: 100,
      confirmedPct: 0,
      inProgressPct: 0,
      newPct: 0,
    });
  });
});
