import { basename } from 'path';
import type { Project } from '@cat/core/project';
import type { FileParseRowArtifact } from './artifacts';

export type ProgressEmitter = (current: number) => Promise<void>;

export function fileParseRowToUnit(
  row: FileParseRowArtifact,
  project: Project,
  inputPath: string,
) {
  return {
    id: row.unitId,
    source: row.source,
    target: row.target,
    sourceLanguage: project.srcLang,
    targetLanguage: project.tgtLang,
    context: row.context,
    fileName: basename(inputPath),
    rowNumber: row.rowNumber,
    metadata: {
      rowIndex: row.rowIndex,
      rowNumber: row.rowNumber,
    },
  };
}

export function createProgressEmitter(
  onProgress: ((current: number, total: number) => void) | undefined,
  total: number,
): ProgressEmitter {
  let lastCurrent: number | undefined;

  return async (current: number): Promise<void> => {
    if (!onProgress || current === lastCurrent) return;
    lastCurrent = current;
    onProgress(current, total);
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
}

export function validatePositiveInteger(
  value: number | undefined,
  name: string,
): number | undefined {
  if (value === undefined) return undefined;

  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}
