const DEFAULT_SNAPSHOT_EVERY_UNITS = 10;
const DEFAULT_SNAPSHOT_EVERY_SECONDS = 60;

export interface SnapshotThrottleOptions {
  snapshotEveryUnits?: number;
  snapshotEverySeconds?: number;
  now?: () => number;
}

export class SnapshotThrottle {
  private readonly snapshotEveryUnits: number;
  private readonly snapshotEveryMilliseconds: number;
  private readonly now: () => number;
  private lastSnapshotCompletedCount = 0;
  private lastSnapshotAt: number;

  constructor(options: SnapshotThrottleOptions = {}) {
    this.snapshotEveryUnits = positiveIntegerOrDefault(
      options.snapshotEveryUnits,
      DEFAULT_SNAPSHOT_EVERY_UNITS,
    );
    this.snapshotEveryMilliseconds =
      positiveIntegerOrDefault(options.snapshotEverySeconds, DEFAULT_SNAPSHOT_EVERY_SECONDS) * 1000;
    this.now = options.now ?? Date.now;
    this.lastSnapshotAt = this.now();
  }

  shouldSnapshot(completedCount: number): boolean {
    if (!Number.isFinite(completedCount) || completedCount <= this.lastSnapshotCompletedCount) {
      return false;
    }

    const completedDelta = completedCount - this.lastSnapshotCompletedCount;
    const elapsed = this.now() - this.lastSnapshotAt;

    if (completedDelta < this.snapshotEveryUnits && elapsed < this.snapshotEveryMilliseconds) {
      return false;
    }

    this.lastSnapshotCompletedCount = completedCount;
    this.lastSnapshotAt = this.now();
    return true;
  }
}

function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isInteger(value) || value < 1) {
    return fallback;
  }

  return value;
}
