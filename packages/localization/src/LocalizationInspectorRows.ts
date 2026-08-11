import type { Segment } from '@cat/core/models';
import type { FileParseRowArtifact, InspectUnitArtifact } from './artifacts';
import { computeSourceHash } from './job/sourceHash';
import type { JobUnit, TranslationTask } from './job/types';
import { buildWindowModeContext } from './requestModes/shared/contextWindowBuilder';
import { unitKey } from './requestModes/shared/unitIdentity';

export interface InspectRowWithSegment {
  row: FileParseRowArtifact;
  segment: Segment;
  sourceIndex: number;
}

export interface InspectReadyRow extends InspectRowWithSegment {
  unit: InspectUnitArtifact;
  unitIndex: number;
}

export function inspectRowsToJobUnits(
  rows: FileParseRowArtifact[],
  documentId: string,
): JobUnit[] {
  return rows
    .filter((row) => row.source.trim())
    .map((row) => ({
      documentId,
      unitId: row.unitId,
      source: row.source,
      target: row.target,
      context: row.context,
      rowNumber: row.rowNumber,
      sourceHash: computeSourceHash({
        source: row.source,
        context: row.context,
        resumeFingerprint: 'inspect',
      }),
      metadata: {
        rowIndex: row.rowIndex,
        rowNumber: row.rowNumber,
      },
    }));
}

export function buildInspectWindowContext(
  rows: FileParseRowArtifact[],
  currentRows: InspectReadyRow[],
  documentId: string,
): ReturnType<typeof buildWindowModeContext> {
  const jobUnits = inspectRowsToJobUnits(rows, documentId);
  const jobUnitsByUnitId = new Map(jobUnits.map((unit) => [unit.unitId, unit]));
  const currentUnits = currentRows.flatMap((row) => {
    const unit = jobUnitsByUnitId.get(row.row.unitId);
    return unit ? [unit] : [];
  });
  const completedResults = new Map(
    jobUnits
      .filter((unit) => unit.target?.trim())
      .map((unit) => [
        unitKey(unit),
        {
          jobId: 'inspect',
          documentId: unit.documentId,
          unitId: unit.unitId,
          sourceHash: unit.sourceHash,
          status: 'skipped' as const,
          source: unit.source,
          target: unit.target,
          metadata: unit.metadata,
        },
      ]),
  );
  const task: TranslationTask = {
    taskId: 'inspect-window-context',
    units: currentUnits,
  };

  return buildWindowModeContext({
    task,
    jobUnits,
    currentUnits,
    completedResults,
  });
}

export function isInspectRequestRow(row: FileParseRowArtifact): boolean {
  return !row.target.trim();
}
