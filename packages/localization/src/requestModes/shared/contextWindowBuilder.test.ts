import { describe, expect, it } from 'vitest';
import type { JobUnit, TranslationTask, UnitResult } from '../../job/types';
import {
  buildWindowModeContext,
  mergeCompletedResults,
} from './contextWindowBuilder';

function unit(row: number, source: string, target = ''): JobUnit {
  return {
    documentId: 'book.xlsx',
    unitId: `row-${row}`,
    source,
    target,
    sourceHash: `hash-${row}`,
  };
}

function result(unit: JobUnit, target: string, status: UnitResult['status'] = 'translated'): UnitResult {
  return {
    jobId: 'job-1',
    documentId: unit.documentId,
    unitId: unit.unitId,
    sourceHash: unit.sourceHash,
    status,
    source: unit.source,
    target,
  };
}

describe('buildWindowModeContext', () => {
  it('selects previous translated rows before the last current unit and reverses them into file order', () => {
    const jobUnits = [
      unit(1, 'One'),
      unit(2, 'Two'),
      unit(3, 'Three'),
      unit(4, 'Four'),
      unit(5, 'Five'),
      unit(6, 'Six'),
      unit(7, 'Seven'),
    ];
    const task: TranslationTask = {
      taskId: 'window-task-2',
      units: [jobUnits[5], jobUnits[6]],
    };
    const completedResults = new Map(
      jobUnits.slice(0, 5).map((jobUnit, index) => [
        `${jobUnit.documentId}\u0000${jobUnit.unitId}`,
        result(jobUnit, `T${index + 1}`),
      ]),
    );

    expect(
      buildWindowModeContext({
        task,
        jobUnits,
        currentUnits: task.units,
        completedResults,
      }).previousContext,
    ).toEqual([
      { source: 'One', target: 'T1' },
      { source: 'Two', target: 'T2' },
      { source: 'Three', target: 'T3' },
      { source: 'Four', target: 'T4' },
      { source: 'Five', target: 'T5' },
    ]);
  });

  it('skips current units and previous rows without reliable targets', () => {
    const jobUnits = [
      unit(1, 'Ready'),
      unit(2, 'Empty target'),
      unit(3, 'Current A'),
      unit(4, 'Current B'),
      unit(5, 'Next'),
    ];
    const task: TranslationTask = {
      taskId: 'window-task-1',
      units: [jobUnits[2], jobUnits[3]],
    };
    const completedResults = new Map([
      [`${jobUnits[0].documentId}\u0000${jobUnits[0].unitId}`, result(jobUnits[0], 'Pret')],
      [`${jobUnits[1].documentId}\u0000${jobUnits[1].unitId}`, result(jobUnits[1], '')],
      [`${jobUnits[2].documentId}\u0000${jobUnits[2].unitId}`, result(jobUnits[2], 'Should not appear')],
    ]);

    expect(
      buildWindowModeContext({
        task,
        jobUnits,
        currentUnits: task.units,
        completedResults,
      }),
    ).toEqual({
      previousContext: [{ source: 'Ready', target: 'Pret' }],
      nextContext: [{ source: 'Next' }],
    });
  });

  it('selects up to five next source-bearing rows after the last current unit', () => {
    const jobUnits = [
      unit(1, 'Current'),
      unit(2, 'Next 1'),
      unit(3, '   '),
      unit(4, 'Next 2'),
      unit(5, 'Next 3'),
      unit(6, 'Next 4'),
      unit(7, 'Next 5'),
      unit(8, 'Next 6'),
    ];
    const task: TranslationTask = {
      taskId: 'window-task-1',
      units: [jobUnits[0]],
    };

    expect(
      buildWindowModeContext({
        task,
        jobUnits,
        currentUnits: task.units,
        completedResults: new Map(),
      }).nextContext,
    ).toEqual([
      { source: 'Next 1' },
      { source: 'Next 2' },
      { source: 'Next 3' },
      { source: 'Next 4' },
      { source: 'Next 5' },
    ]);
  });

  it('falls back to task units when the full job order is unavailable', () => {
    const current = unit(1, 'Current');
    const next = unit(2, 'Next');
    const task: TranslationTask = {
      taskId: 'ad-hoc',
      units: [current, next],
    };

    expect(
      buildWindowModeContext({
        task,
        jobUnits: [],
        currentUnits: [current],
        completedResults: new Map(),
      }).nextContext,
    ).toEqual([{ source: 'Next' }]);
  });
});

describe('mergeCompletedResults', () => {
  it('adds skipped rows with non-empty existing targets as trusted previous context inputs', () => {
    const first = unit(1, 'First');
    const skippedWithTarget = result(unit(2, 'Skipped'), 'Deja traduit', 'skipped');
    const skippedWithoutTarget = result(unit(3, 'Blank'), '', 'skipped');

    expect(
      [...mergeCompletedResults(new Map([[`${first.documentId}\u0000${first.unitId}`, result(first, 'Premier')]]), [
        skippedWithTarget,
        skippedWithoutTarget,
      ]).values()].map((item) => [item.unitId, item.target]),
    ).toEqual([
      ['row-1', 'Premier'],
      ['row-2', 'Deja traduit'],
    ]);
  });
});
