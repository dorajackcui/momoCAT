import { describe, expect, it } from 'vitest';
import type { JobUnit, UnitResult } from '../../job/types';
import type { TranslateUnitResult } from '../../types';
import {
  buildTranslateUnitsResult,
  jobUnitToExternalUnit,
  toArtifactRecord,
  toUnitResult,
} from './results';
import { batchResponseId, unitKey } from './unitIdentity';

const jobUnit: JobUnit = {
  documentId: 'file name.xlsx',
  unitId: 'row-2',
  source: 'Hello',
  target: 'Bonjour',
  context: 'button',
  rowNumber: 2,
  sourceHash: 'hash-1',
  metadata: { rowIndex: 1, rowNumber: 2 },
};

describe('unit identity helpers', () => {
  it('builds stable internal keys and URL-safe Window Mode response ids', () => {
    expect(unitKey(jobUnit)).toBe('file name.xlsx\u0000row-2');
    expect(batchResponseId(jobUnit)).toBe('file%20name.xlsx#row-2');
  });
});

describe('result helpers', () => {
  it('converts a job unit and TranslateUnitResult into a UnitResult', () => {
    const translated: TranslateUnitResult = {
      id: 'row-2',
      source: 'Hello',
      target: 'Bonjour',
      status: 'translated',
      references: { tm: [], tb: [] },
      metadata: { rowIndex: 1 },
    };

    expect(toUnitResult('job-1', jobUnit, translated)).toEqual({
      jobId: 'job-1',
      documentId: 'file name.xlsx',
      unitId: 'row-2',
      sourceHash: 'hash-1',
      status: 'translated',
      source: 'Hello',
      target: 'Bonjour',
      error: undefined,
      references: { tm: [], tb: [] },
      metadata: { rowIndex: 1, rowNumber: 2 },
    });
  });

  it('builds artifact records without API keys', () => {
    const result: UnitResult = {
      jobId: 'job-1',
      documentId: jobUnit.documentId,
      unitId: jobUnit.unitId,
      sourceHash: jobUnit.sourceHash,
      status: 'translated',
      source: jobUnit.source,
      target: 'Bonjour',
    };

    expect(JSON.stringify(toArtifactRecord('job-1', 'task-1', jobUnit, result))).not.toMatch(
      /api[_-]?key/i,
    );
  });

  it('keeps source, target, context, row number, and metadata when converting job units', () => {
    expect(jobUnitToExternalUnit(jobUnit)).toEqual({
      id: 'row-2',
      source: 'Hello',
      target: 'Bonjour',
      context: 'button',
      rowNumber: 2,
      metadata: { rowIndex: 1, rowNumber: 2 },
    });
  });

  it('summarizes translated, skipped, failed, and reused unit results', () => {
    expect(
      buildTranslateUnitsResult([
        { id: 'a', source: 'A', target: 'AA', status: 'translated' },
        { id: 'b', source: 'B', target: 'BB', status: 'skipped' },
        { id: 'c', source: 'C', error: 'boom', status: 'failed' },
        { id: 'd', source: 'D', target: 'DD', status: 'reused' },
      ]),
    ).toEqual({
      summary: { total: 4, translated: 1, skipped: 1, failed: 1, reused: 1 },
      results: [
        { id: 'a', source: 'A', target: 'AA', status: 'translated' },
        { id: 'b', source: 'B', target: 'BB', status: 'skipped' },
        { id: 'c', source: 'C', error: 'boom', status: 'failed' },
        { id: 'd', source: 'D', target: 'DD', status: 'reused' },
      ],
    });
  });
});
