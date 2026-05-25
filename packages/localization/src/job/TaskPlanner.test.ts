import { describe, expect, it } from 'vitest';
import { SnapshotThrottle } from './SnapshotThrottle';
import { OneUnitTaskPlanner, WindowModeTaskPlanner, WindowPartialTaskPlanner } from './TaskPlanner';
import type { JobUnit, TranslationJob, UnitResult } from './types';

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

describe('WindowModeTaskPlanner', () => {
  it('creates default batches of five in input order', () => {
    const units = Array.from({ length: 12 }, (_, index) =>
      makeUnit({ unitId: `unit-${index + 1}` }),
    );
    const planner = new WindowModeTaskPlanner();

    const tasks = planner.plan(units);

    expect(tasks).toEqual([
      { taskId: 'window-task-1', units: units.slice(0, 5) },
      { taskId: 'window-task-2', units: units.slice(5, 10) },
      { taskId: 'window-task-3', units: units.slice(10, 12) },
    ]);
  });

  it('creates custom-sized batches in input order', () => {
    const units = [
      makeUnit({ unitId: 'unit-1' }),
      makeUnit({ unitId: 'unit-2' }),
      makeUnit({ unitId: 'unit-3' }),
    ];
    const planner = new WindowModeTaskPlanner({ batchSize: 2 });

    const tasks = planner.plan(units);

    expect(tasks).toEqual([
      { taskId: 'window-task-1', units: units.slice(0, 2) },
      { taskId: 'window-task-2', units: units.slice(2, 3) },
    ]);
  });

  it.each([0, -1, 1.5, Number.NaN, 6])(
    'rejects invalid batch size %s',
    (batchSize) => {
      expect(() => new WindowModeTaskPlanner({ batchSize })).toThrow(
        'Window Mode batchSize must be an integer from 1 to 5.',
      );
    },
  );
});

describe('WindowPartialTaskPlanner', () => {
  it('keeps the physical scan window while requesting only blank targets', () => {
    const units = Array.from({ length: 5 }, (_, index) =>
      makeUnit({
        unitId: `unit-${index + 1}`,
        target: index === 1 || index === 3 ? `target ${index + 1}` : '',
      }),
    );
    const planner = new WindowPartialTaskPlanner();

    const tasks = planner.planJob({
      job: makeJob(units),
      completedResults: new Map(),
      targetScope: 'blank-only',
    });

    expect(tasks).toEqual([
      {
        taskId: 'window-partial-task-1',
        requestMode: 'window-partial',
        scanWindowUnits: units,
        units,
        requestUnitKeys: ['doc-1\u0000unit-1', 'doc-1\u0000unit-3', 'doc-1\u0000unit-5'],
      },
    ]);
  });

  it('does not collapse physical windows around completed rows', () => {
    const units = Array.from({ length: 6 }, (_, index) =>
      makeUnit({ unitId: `unit-${index + 1}`, sourceHash: `hash-${index + 1}` }),
    );
    const completedResults = new Map<string, UnitResult>([
      ['doc-1\u0000unit-1', makeResult(units[0])],
      ['doc-1\u0000unit-2', makeResult(units[1])],
    ]);
    const planner = new WindowPartialTaskPlanner();

    const tasks = planner.planJob({
      job: makeJob(units),
      completedResults,
      targetScope: 'blank-only',
    });

    expect(tasks).toEqual([
      expect.objectContaining({
        taskId: 'window-partial-task-1',
        scanWindowUnits: units.slice(0, 5),
        units: units.slice(2, 5),
        requestUnitKeys: ['doc-1\u0000unit-3', 'doc-1\u0000unit-4', 'doc-1\u0000unit-5'],
      }),
      expect.objectContaining({
        taskId: 'window-partial-task-2',
        scanWindowUnits: units.slice(5, 6),
        units: units.slice(5, 6),
        requestUnitKeys: ['doc-1\u0000unit-6'],
      }),
    ]);
  });

  it('keeps task ids tied to physical windows when earlier windows are fully completed', () => {
    const units = Array.from({ length: 6 }, (_, index) =>
      makeUnit({ unitId: `unit-${index + 1}`, sourceHash: `hash-${index + 1}` }),
    );
    const completedResults = new Map<string, UnitResult>(
      units.slice(0, 5).map((unit) => [`doc-1\u0000${unit.unitId}`, makeResult(unit)]),
    );
    const planner = new WindowPartialTaskPlanner();

    const tasks = planner.planJob({
      job: makeJob(units),
      completedResults,
      targetScope: 'blank-only',
    });

    expect(tasks).toEqual([
      expect.objectContaining({
        taskId: 'window-partial-task-2',
        scanWindowUnits: units.slice(5, 6),
        units: units.slice(5, 6),
      }),
    ]);
  });

  it('creates a skip-only task when all fresh rows already have targets', () => {
    const units = [
      makeUnit({ unitId: 'unit-1', target: 'existing 1' }),
      makeUnit({ unitId: 'unit-2', target: 'existing 2' }),
    ];
    const planner = new WindowPartialTaskPlanner();

    const tasks = planner.planJob({
      job: makeJob(units),
      completedResults: new Map(),
      targetScope: 'blank-only',
    });

    expect(tasks).toEqual([
      expect.objectContaining({
        requestMode: 'window-partial',
        scanWindowUnits: units,
        units,
        requestUnitKeys: [],
      }),
    ]);
  });

  it('creates no task when all rows are already completed', () => {
    const units = [makeUnit({ unitId: 'unit-1' }), makeUnit({ unitId: 'unit-2' })];
    const completedResults = new Map<string, UnitResult>([
      ['doc-1\u0000unit-1', makeResult(units[0])],
      ['doc-1\u0000unit-2', makeResult(units[1])],
    ]);
    const planner = new WindowPartialTaskPlanner();

    const tasks = planner.planJob({
      job: makeJob(units),
      completedResults,
      targetScope: 'blank-only',
    });

    expect(tasks).toEqual([]);
  });

  it('requests existing-target rows when overwriting non-confirmed targets', () => {
    const units = [
      makeUnit({ unitId: 'unit-1', target: 'existing 1' }),
      makeUnit({ unitId: 'unit-2', target: 'existing 2' }),
    ];
    const planner = new WindowPartialTaskPlanner();

    const tasks = planner.planJob({
      job: makeJob(units),
      completedResults: new Map(),
      targetScope: 'overwrite-non-confirmed',
    });

    expect(tasks[0]?.requestUnitKeys).toEqual(['doc-1\u0000unit-1', 'doc-1\u0000unit-2']);
  });

  it.each([0, -1, 1.5, Number.NaN, 6])(
    'rejects invalid batch size %s',
    (batchSize) => {
      expect(() => new WindowPartialTaskPlanner({ batchSize })).toThrow(
        'Window Mode batchSize must be an integer from 1 to 5.',
      );
    },
  );
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

function makeJob(units: JobUnit[]): TranslationJob {
  return {
    id: 'job-1',
    projectId: 1,
    units,
  };
}

function makeResult(unit: JobUnit): UnitResult {
  return {
    jobId: 'job-1',
    documentId: unit.documentId,
    unitId: unit.unitId,
    sourceHash: unit.sourceHash,
    status: 'translated',
    source: unit.source,
    target: `target ${unit.unitId}`,
  };
}
