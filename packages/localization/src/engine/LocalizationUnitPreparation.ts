import type { Segment } from '@cat/core/models';
import type { TagPolicy } from '@cat/core/tag';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { UnitResult } from '../job/types';
import type { ProjectRecord } from '../ports';
import { createTransientSegment } from '../transientSegment';
import type {
  ExternalTranslationUnit,
  LocalizationTargetScope,
  TranslateUnitResult,
} from '../types';

export type PreparedLocalizationUnit =
  | {
      kind: 'skipped';
      result: TranslateUnitResult;
    }
  | {
      kind: 'translatable';
      unit: ExternalTranslationUnit;
      segment: Segment;
    };

export function prepareExternalTranslationUnit(
  unit: ExternalTranslationUnit,
  index: number,
  project: ProjectRecord,
  targetScope: LocalizationTargetScope,
  tagPolicy: TagPolicy,
): PreparedLocalizationUnit {
  return prepareTranslationUnit({
    unit,
    index,
    project,
    tagPolicy,
    skipExistingTarget: targetScope === 'blank-only',
  });
}

export function prepareJobTranslationUnit(
  unit: ExternalTranslationUnit,
  index: number,
  project: ProjectRecord,
  tagPolicy: TagPolicy,
): PreparedLocalizationUnit {
  return prepareTranslationUnit({
    unit,
    index,
    project,
    tagPolicy,
    skipExistingTarget: true,
  });
}

export function unitResultToPublicResult(result: UnitResult): TranslateUnitResult {
  if (result.status === 'failed') {
    return {
      id: result.unitId,
      source: result.source,
      target: result.target,
      status: 'failed',
      error: result.error ?? 'Translation failed',
      references: result.references,
      metadata: result.metadata,
    };
  }

  return {
    id: result.unitId,
    source: result.source,
    target: result.target ?? '',
    status:
      result.status === 'translated' || result.status === 'reused' ? result.status : 'skipped',
    references: result.references,
    metadata: result.metadata,
  };
}

function prepareTranslationUnit(params: {
  unit: ExternalTranslationUnit;
  index: number;
  project: ProjectRecord;
  tagPolicy: TagPolicy;
  skipExistingTarget: boolean;
}): PreparedLocalizationUnit {
  const { unit, index, project, tagPolicy, skipExistingTarget } = params;
  if (!unit.source.trim() || unit.locked) {
    return skippedUnit(unit, unit.target ?? '');
  }

  const segment = createTransientSegment(
    unit,
    index,
    {
      projectId: project.id,
      sourceLanguage: project.srcLang,
      targetLanguage: project.tgtLang,
      fileName: unit.fileName,
    },
    { tagPolicy },
  );
  const existingTarget = serializeTokensToDisplayText(segment.targetTokens);
  if (skipExistingTarget && existingTarget.trim()) {
    return skippedUnit(unit, existingTarget);
  }

  return { kind: 'translatable', unit, segment };
}

function skippedUnit(unit: ExternalTranslationUnit, target: string): PreparedLocalizationUnit {
  return {
    kind: 'skipped',
    result: {
      id: unit.id,
      source: unit.source,
      target,
      status: 'skipped',
      metadata: unit.metadata,
    },
  };
}
