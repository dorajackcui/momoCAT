import { describe, expect, it } from 'vitest';
import type { JobUnit, UnitResult } from '../../job/types';
import { buildWindowPartialReadOnlyContextRows } from './windowPartialContextBuilder';

describe('buildWindowPartialReadOnlyContextRows', () => {
  it('selects previous, current-existing, and next rows while excluding request rows', () => {
    const failedPrevious = jobUnit('row-0', 'Failed previous', 0);
    const units = [
      failedPrevious,
      jobUnit('row-1', 'One', 1),
      jobUnit('row-2', 'Two', 2, 'Deux'),
      jobUnit('row-3', 'Three', 3),
      jobUnit('row-4', 'Four', 4, 'Quatre'),
      jobUnit('row-5', 'Five', 5),
      jobUnit('row-6', 'Six', 6, 'Six target'),
      jobUnit('row-7', 'Seven', 7),
    ];
    const completedResults = new Map([
      [key(units[1]), result(units[1], 'Un')],
      [key(failedPrevious), result(failedPrevious, 'Ancien echec', 'failed')],
    ]);

    const rows = buildWindowPartialReadOnlyContextRows({
      jobUnits: units,
      scanWindowUnits: units.slice(2, 5),
      requestUnitKeys: [key(units[2]), key(units[4])],
      completedResults,
      skippedResults: [result(units[3], 'Trois existant', 'skipped')],
    });

    expect(rows).toEqual([
      { role: 'previous', source: 'One', target: 'Un', rowNumber: 1 },
      { role: 'current-existing', source: 'Three', target: 'Trois existant', rowNumber: 3 },
      { role: 'next', source: 'Five', rowNumber: 5 },
      { role: 'next', source: 'Six', target: 'Six target', rowNumber: 6 },
      { role: 'next', source: 'Seven', rowNumber: 7 },
    ]);
  });
});

function jobUnit(unitId: string, source: string, rowNumber: number, target?: string): JobUnit {
  return {
    documentId: 'sheet.xlsx',
    unitId,
    source,
    target,
    rowNumber,
    sourceHash: `hash-${unitId}`,
  };
}

function result(
  unit: JobUnit,
  target: string,
  status: UnitResult['status'] = 'translated',
): UnitResult {
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

function key(unit: Pick<JobUnit, 'documentId' | 'unitId'>): string {
  return `${unit.documentId}\u0000${unit.unitId}`;
}
