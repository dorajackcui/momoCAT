import type { Segment } from '@cat/core/models';
import { computeTagsSignature, parseDisplayTextToTokens, type TagPolicy } from '@cat/core/tag';
import { computeMatchKey, computeSrcHash } from '@cat/core/text';
import type { ExternalTranslationUnit } from './types';
import { resolveTagPolicy } from './tagPolicy';

export interface TransientSegmentContext {
  projectId?: number;
  sourceLanguage?: string;
  targetLanguage?: string;
  fileName?: string;
}

export type TransientSegment = Omit<Segment, 'meta'> & {
  meta: Segment['meta'] & {
    externalUnitId: string;
    projectId?: number;
    sourceLanguage?: string;
    targetLanguage?: string;
    fileName?: string;
    rowNumber?: number;
    [key: string]: unknown;
  };
};

export interface TransientSegmentOptions {
  tagPolicy?: TagPolicy;
}

const TRANSIENT_SEGMENT_ID_PREFIX = 'transient:';
const TRANSIENT_FILE_ID = 0;

export function createTransientSegment(
  unit: ExternalTranslationUnit,
  orderIndex: number,
  context: TransientSegmentContext = {},
  options: TransientSegmentOptions = {},
): TransientSegment {
  const tagPolicy = resolveTagPolicy(options.tagPolicy);
  const sourceTokens = parseDisplayTextToTokens(unit.source, { tagPolicy });
  const targetTokens = unit.target ? parseDisplayTextToTokens(unit.target, { tagPolicy }) : [];
  const tagsSignature = computeTagsSignature(sourceTokens);
  const matchKey = computeMatchKey(sourceTokens);
  const now = new Date().toISOString();

  return {
    segmentId: toTransientSegmentId(unit.id),
    fileId: TRANSIENT_FILE_ID,
    orderIndex,
    sourceTokens,
    targetTokens,
    status: targetTokens.length > 0 ? 'translated' : 'new',
    tagsSignature,
    matchKey,
    srcHash: computeSrcHash(matchKey, tagsSignature),
    meta: {
      ...(unit.metadata ?? {}),
      externalUnitId: unit.id,
      projectId: context.projectId,
      sourceLanguage: unit.sourceLanguage ?? context.sourceLanguage,
      targetLanguage: unit.targetLanguage ?? context.targetLanguage,
      context: unit.context,
      fileName: unit.fileName ?? context.fileName,
      rowNumber: unit.rowNumber,
      updatedAt: now,
    },
  };
}

export function toTransientSegmentId(unitId: string): string {
  return `${TRANSIENT_SEGMENT_ID_PREFIX}${unitId}`;
}
