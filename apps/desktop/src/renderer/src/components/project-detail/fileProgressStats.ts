import type { ProjectFile } from '@cat/core/project';

interface FileSegmentStatusStatsLike {
  totalSegments: number;
  qaProblemSegments: number;
  confirmedSegmentsForBar: number;
  inProgressSegments: number;
  emptySegments: number;
}

type FileProgressInput = ProjectFile & {
  segmentStatusStats: FileSegmentStatusStatsLike;
};

export interface FileProgressBuckets {
  totalSegments: number;
  qaProblemSegments: number;
  confirmedSegmentsForBar: number;
  inProgressSegments: number;
  emptySegments: number;
}

export interface FileProgressPercentages {
  qaProblemPct: number;
  confirmedPct: number;
  inProgressPct: number;
  emptyPct: number;
  confirmedDisplayPct: number;
}

export function deriveFileProgressBuckets(file: FileProgressInput): FileProgressBuckets {
  const stats = file.segmentStatusStats;

  const totalSegments = Math.max(0, Number(stats.totalSegments));
  const qaProblemSegments = Math.max(0, Number(stats.qaProblemSegments));
  const confirmedSegmentsForBar = Math.max(0, Number(stats.confirmedSegmentsForBar));
  const inProgressSegments = Math.max(0, Number(stats.inProgressSegments));
  const emptySegments = Math.max(
    0,
    totalSegments - qaProblemSegments - confirmedSegmentsForBar - inProgressSegments,
  );

  return {
    totalSegments,
    qaProblemSegments,
    confirmedSegmentsForBar,
    inProgressSegments,
    emptySegments,
  };
}

export function toPercent(buckets: FileProgressBuckets): FileProgressPercentages {
  const total = buckets.totalSegments;
  const ratio = (value: number) => (total === 0 ? 0 : (value / total) * 100);
  const confirmedPct = ratio(buckets.confirmedSegmentsForBar);

  return {
    qaProblemPct: ratio(buckets.qaProblemSegments),
    confirmedPct,
    inProgressPct: ratio(buckets.inProgressSegments),
    emptyPct: ratio(buckets.emptySegments),
    confirmedDisplayPct: Math.round(confirmedPct),
  };
}
