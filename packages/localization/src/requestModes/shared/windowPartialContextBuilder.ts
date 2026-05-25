import type { JobUnit, UnitResult } from '../../job/types';
import { unitKey } from './unitIdentity';

export interface WindowPartialReadOnlyContextRow {
  role: 'previous' | 'current-existing' | 'next';
  source: string;
  target?: string;
  rowNumber?: number;
}

export interface WindowPartialContextInput {
  jobUnits: JobUnit[];
  scanWindowUnits: JobUnit[];
  requestUnitKeys: string[];
  completedResults?: ReadonlyMap<string, UnitResult>;
  skippedResults?: UnitResult[];
  maxPreviousRows?: number;
  maxNextRows?: number;
}

export function buildWindowPartialReadOnlyContextRows(
  input: WindowPartialContextInput,
): WindowPartialReadOnlyContextRow[] {
  const jobUnits = input.jobUnits.length > 0 ? input.jobUnits : input.scanWindowUnits;
  const indexByKey = new Map(jobUnits.map((unit, index) => [unitKey(unit), index]));
  const scanIndexes = input.scanWindowUnits
    .map((unit) => indexByKey.get(unitKey(unit)))
    .filter((index): index is number => typeof index === 'number');

  if (scanIndexes.length === 0) {
    return [];
  }

  const requestKeys = new Set(input.requestUnitKeys);
  const scanKeys = new Set(input.scanWindowUnits.map(unitKey));
  const firstScanIndex = Math.min(...scanIndexes);
  const lastScanIndex = Math.max(...scanIndexes);
  const previousRows: WindowPartialReadOnlyContextRow[] = [];
  const maxPreviousRows = input.maxPreviousRows ?? 5;
  const maxNextRows = input.maxNextRows ?? 5;

  for (let index = firstScanIndex - 1; index >= 0 && previousRows.length < maxPreviousRows; index -= 1) {
    const unit = jobUnits[index];
    if (requestKeys.has(unitKey(unit))) {
      continue;
    }

    const target = trustedTargetForUnit(unit, input);

    if (unit.source.trim() && target) {
      previousRows.push(toReadOnlyContextRow('previous', unit, target));
    }
  }

  const currentRows: WindowPartialReadOnlyContextRow[] = [];
  for (let index = firstScanIndex; index <= lastScanIndex; index += 1) {
    const unit = jobUnits[index];
    const key = unitKey(unit);

    if (!scanKeys.has(key) || requestKeys.has(key)) {
      continue;
    }

    const target = trustedTargetForUnit(unit, input);
    if (unit.source.trim() && target) {
      currentRows.push(toReadOnlyContextRow('current-existing', unit, target));
    }
  }

  const nextRows: WindowPartialReadOnlyContextRow[] = [];
  for (let index = lastScanIndex + 1; index < jobUnits.length && nextRows.length < maxNextRows; index += 1) {
    const unit = jobUnits[index];

    if (requestKeys.has(unitKey(unit)) || !unit.source.trim()) {
      continue;
    }

    nextRows.push(toReadOnlyContextRow('next', unit, trustedTargetForUnit(unit, input)));
  }

  return [...previousRows.reverse(), ...currentRows, ...nextRows];
}

function trustedTargetForUnit(
  unit: JobUnit,
  input: Pick<WindowPartialContextInput, 'completedResults' | 'skippedResults'>,
): string | undefined {
  const completed = input.completedResults?.get(unitKey(unit));
  if (completed && completed.status !== 'failed' && completed.target?.trim()) {
    return completed.target;
  }

  const skipped = input.skippedResults?.find((result) => unitKey(result) === unitKey(unit));
  if (skipped && skipped.status !== 'failed' && skipped.target?.trim()) {
    return skipped.target;
  }

  return unit.target?.trim() ? unit.target : undefined;
}

function toReadOnlyContextRow(
  role: WindowPartialReadOnlyContextRow['role'],
  unit: JobUnit,
  target?: string,
): WindowPartialReadOnlyContextRow {
  return {
    role,
    source: unit.source,
    ...(target ? { target } : {}),
    ...(typeof unit.rowNumber === 'number' ? { rowNumber: unit.rowNumber } : {}),
  };
}
