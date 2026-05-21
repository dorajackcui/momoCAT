import type {
  ArtifactRecord,
  TranslationTask,
  UnitResult,
  UnitResultStatus,
} from '../../job/types';
import type {
  ExternalTranslationUnit,
  TranslateUnitResult,
  TranslateUnitsResult,
} from '../../types';
import type { PreparedTranslationArtifacts } from '../types';

export function jobUnitToExternalUnit(unit: {
  unitId: string;
  source: string;
  target?: string;
  context?: string;
  rowNumber?: number;
  metadata?: Record<string, unknown>;
}): ExternalTranslationUnit {
  return {
    id: unit.unitId,
    source: unit.source,
    target: unit.target,
    context: unit.context,
    rowNumber: unit.rowNumber,
    metadata: unit.metadata,
  };
}

export function toUnitResult(
  jobId: string,
  unit: TranslationTask['units'][number],
  result: TranslateUnitResult,
): UnitResult {
  return {
    jobId,
    documentId: unit.documentId,
    unitId: unit.unitId,
    sourceHash: unit.sourceHash,
    status: result.status as UnitResultStatus,
    source: unit.source,
    target: result.target,
    error: result.status === 'failed' ? result.error : undefined,
    references: result.references,
    metadata: unit.metadata,
  };
}

export function toArtifactRecord(
  jobId: string,
  taskId: string,
  unit: TranslationTask['units'][number],
  result: UnitResult,
  artifacts?: PreparedTranslationArtifacts,
): ArtifactRecord {
  return {
    job: jobId,
    task: taskId,
    doc: unit.documentId,
    unit: unit.unitId,
    tm: artifacts?.tm,
    tb: artifacts?.tb,
    prompt: artifacts?.prompt,
    result,
    error: result.error,
    at: new Date().toISOString(),
  };
}

export function buildTranslateUnitsResult(results: TranslateUnitResult[]): TranslateUnitsResult {
  const reused = results.filter((result) => result.status === 'reused').length;
  const summary: TranslateUnitsResult['summary'] = {
    total: results.length,
    translated: results.filter((result) => result.status === 'translated').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    failed: results.filter((result) => result.status === 'failed').length,
  };

  if (reused > 0) {
    summary.reused = reused;
  }

  return { summary, results };
}
