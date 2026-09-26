import type { Segment, SegmentStatus, Token } from '@cat/core/models';
import { isQASettings, type ProjectQASettings, type ProjectType } from '@cat/core/project';
import type { TagPolicy } from '@cat/core/tag';
import type { ImportOptions, PastedSourceFileInput, SelectedSegmentUpdate } from '../../shared/ipc';
import {
  isArrayOf,
  isBoolean,
  isFiniteNumber,
  isId,
  isNonEmptyString,
  isNonNegativeInteger,
  isOptional,
  isRecord,
  isString,
} from './argumentValidation';

const SEGMENT_STATUSES = {
  empty: true,
  draft: true,
  confirmed: true,
} satisfies Record<SegmentStatus, true>;

const TOKEN_TYPES = {
  text: true,
  tag: true,
  locked: true,
  ws: true,
} satisfies Record<Token['type'], true>;

export function isSegmentStatus(value: unknown): value is SegmentStatus {
  return isString(value) && Object.hasOwn(SEGMENT_STATUSES, value);
}

export function isSelectedSegmentUpdates(value: unknown): value is SelectedSegmentUpdate[] {
  return (
    isArrayOf(
      value,
      (item): item is SelectedSegmentUpdate =>
        isRecord(item) &&
        isNonEmptyString(item.segmentId) &&
        isTokenArray(item.targetTokens) &&
        isSegmentStatus(item.status),
    ) &&
    value.length > 0 &&
    new Set(value.map((item) => item.segmentId)).size === value.length
  );
}

function isToken(value: unknown): value is Token {
  if (
    !isRecord(value) ||
    !isString(value.type) ||
    !Object.hasOwn(TOKEN_TYPES, value.type) ||
    !isString(value.content)
  ) {
    return false;
  }
  const meta = value.meta;
  if (meta === undefined) return true;
  return (
    isRecord(meta) &&
    isOptional(meta.id, isString) &&
    (meta.tagType === undefined ||
      meta.tagType === 'paired-start' ||
      meta.tagType === 'paired-end' ||
      meta.tagType === 'standalone') &&
    isOptional(meta.pairedIndex, isFiniteNumber) &&
    (meta.validationState === undefined ||
      meta.validationState === 'valid' ||
      meta.validationState === 'error' ||
      meta.validationState === 'warning')
  );
}

export function isTokenArray(value: unknown): value is Token[] {
  return isArrayOf(value, isToken);
}

/** Match workers consume token/hash identity and context; domain semantics stay in services. */
export function isSegment(value: unknown): value is Segment {
  return (
    isRecord(value) &&
    isNonEmptyString(value.segmentId) &&
    isId(value.fileId) &&
    isNonNegativeInteger(value.orderIndex) &&
    isTokenArray(value.sourceTokens) &&
    isTokenArray(value.targetTokens) &&
    isSegmentStatus(value.status) &&
    isString(value.tagsSignature) &&
    isString(value.matchKey) &&
    isString(value.srcHash) &&
    isRecord(value.meta) &&
    isString(value.meta.updatedAt) &&
    isOptional(value.meta.context, isString)
  );
}

export function isProjectType(value: unknown): value is ProjectType {
  return value === 'translation' || value === 'custom';
}

export function isProjectQASettings(value: unknown): value is ProjectQASettings {
  return isQASettings(value);
}

function isTagPolicy(value: unknown): value is TagPolicy {
  return value === 'default' || value === 'none';
}

export function isImportOptions(value: unknown): value is ImportOptions {
  return (
    isRecord(value) &&
    isBoolean(value.hasHeader) &&
    isNonNegativeInteger(value.sourceCol) &&
    isNonNegativeInteger(value.targetCol) &&
    isOptional(value.contextCol, isNonNegativeInteger) &&
    isOptional(value.tagPolicy, isTagPolicy)
  );
}

export function isPastedSourceFileInput(value: unknown): value is PastedSourceFileInput {
  return (
    isRecord(value) &&
    isArrayOf(value.sources, isString) &&
    isOptional(value.tagPolicy, isTagPolicy)
  );
}
