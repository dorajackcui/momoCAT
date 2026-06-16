import type { JobUnit, UnitResult } from '../../job/types';

export function unitKey(unit: Pick<JobUnit | UnitResult, 'documentId' | 'unitId'>): string {
  return `${unit.documentId}\u0000${unit.unitId}`;
}

export function batchResponseId(unit: Pick<JobUnit, 'documentId' | 'unitId'>): string {
  return `${encodeURIComponent(unit.documentId)}#${encodeURIComponent(unit.unitId)}`;
}

export function requestResponseId(index: number): string {
  return `r${index + 1}`;
}
