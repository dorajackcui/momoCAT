import { describe, expect, it } from 'vitest';
import { SnapshotThrottle } from './SnapshotThrottle';
import { OneUnitTaskPlanner } from './TaskPlanner';
import type { JobUnit } from './types';

describe('OneUnitTaskPlanner', () => {
  it('creates one deterministic task per unit in input order', () => {
    const units = [
      makeUnit({ unitId: 'unit-1' }),
      makeUnit({ unitId: 'unit-2' }),
      makeUnit({ unitId: 'unit-3' }),
    ];
    const planner = new OneUnitTaskPlanner();

    const tasks = planner.plan(units);

    expect(tasks).toEqual([
      { taskId: 'task-1', units: [units[0]] },
      { taskId: 'task-2', units: [units[1]] },
      { taskId: 'task-3', units: [units[2]] },
    ]);
  });

  it('returns no tasks when there are no pending units', () => {
    const planner = new OneUnitTaskPlanner();

    expect(planner.plan([])).toEqual([]);
  });
});

describe('SnapshotThrottle', () => {
  it('triggers when completed count delta reaches the unit threshold', () => {
    const throttle = new SnapshotThrottle({
      snapshotEveryUnits: 3,
      snapshotEverySeconds: 60,
      now: () => 0,
    });

    expect(throttle.shouldSnapshot(1)).toBe(false);
    expect(throttle.shouldSnapshot(2)).toBe(false);
    expect(throttle.shouldSnapshot(3)).toBe(true);
    throttle.markSnapshotWritten(3);
    expect(throttle.shouldSnapshot(4)).toBe(false);
    expect(throttle.shouldSnapshot(6)).toBe(true);
  });

  it('triggers when elapsed time reaches the seconds threshold', () => {
    let now = 1_000;
    const throttle = new SnapshotThrottle({
      snapshotEveryUnits: 10,
      snapshotEverySeconds: 5,
      now: () => now,
    });

    now = 5_999;
    expect(throttle.shouldSnapshot(1)).toBe(false);

    now = 6_000;
    expect(throttle.shouldSnapshot(2)).toBe(true);
    throttle.markSnapshotWritten(2);

    now = 10_999;
    expect(throttle.shouldSnapshot(3)).toBe(false);

    now = 11_000;
    expect(throttle.shouldSnapshot(4)).toBe(true);
  });

  it('does not trigger repeatedly without new completed units', () => {
    let now = 0;
    const throttle = new SnapshotThrottle({
      snapshotEveryUnits: 2,
      snapshotEverySeconds: 1,
      now: () => now,
    });

    expect(throttle.shouldSnapshot(2)).toBe(true);
    throttle.markSnapshotWritten(2);

    now = 10_000;
    expect(throttle.shouldSnapshot(2)).toBe(false);
  });

  it('uses conservative defaults for missing or invalid thresholds', () => {
    let now = 0;
    const defaultThrottle = new SnapshotThrottle({ now: () => now });
    const invalidThrottle = new SnapshotThrottle({
      snapshotEveryUnits: 0,
      snapshotEverySeconds: Number.NaN,
      now: () => now,
    });

    expect(defaultThrottle.shouldSnapshot(9)).toBe(false);
    expect(defaultThrottle.shouldSnapshot(10)).toBe(true);
    defaultThrottle.markSnapshotWritten(10);
    expect(invalidThrottle.shouldSnapshot(9)).toBe(false);
    expect(invalidThrottle.shouldSnapshot(10)).toBe(true);
    invalidThrottle.markSnapshotWritten(10);

    now = 59_999;
    expect(defaultThrottle.shouldSnapshot(11)).toBe(false);
    expect(invalidThrottle.shouldSnapshot(11)).toBe(false);

    now = 60_000;
    expect(defaultThrottle.shouldSnapshot(12)).toBe(true);
    expect(invalidThrottle.shouldSnapshot(12)).toBe(true);
  });
});

function makeUnit(overrides: Partial<JobUnit> = {}): JobUnit {
  return {
    documentId: 'doc-1',
    unitId: 'unit-1',
    source: 'source',
    sourceHash: 'hash-1',
    ...overrides,
  };
}
