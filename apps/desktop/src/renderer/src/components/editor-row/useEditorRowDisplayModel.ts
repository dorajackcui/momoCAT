import type { Segment } from '@cat/core/models';
import { useMemo } from 'react';
import { buildHighlightChunks, EditorMatchMode } from '../editorFilterUtils';
import type { QaHighlight } from '@cat/core/models';
import { buildEditorHighlightChunks } from '../highlightRanges';
import { hasRefinableTargetText } from './editorRowUtils';

interface UseEditorRowDisplayModelParams {
  segmentStatus: Segment['status'];
  qaIssues: NonNullable<Segment['qaIssues']>;
  isActive: boolean;
  draftText: string;
  sourceEditorText: string;
  sourceTagsCount: number;
  sourceHighlightQuery: string;
  qaHighlights?: QaHighlight[];
  highlightMode: EditorMatchMode;
  showNonPrintingSymbols: boolean;
}

interface EditorRowDisplayModel {
  statusIndicatorClass: string;
  statusTitle: string;
  sourceHighlightChunks: ReturnType<typeof buildHighlightChunks>;
  sourceDisplayText: string;
  canInsertTags: boolean;
  canAITranslate: boolean;
  hasRefinableTarget: boolean;
  showTargetActionButtons: boolean;
}

interface EditorRowActionVisibilityInput {
  isActive: boolean;
  sourceTagsCount: number;
  sourceEditorText: string;
  draftText: string;
}

interface EditorRowActionVisibility {
  canInsertTags: boolean;
  canAITranslate: boolean;
  hasRefinableTarget: boolean;
  showTargetActionButtons: boolean;
}

export function getEditorRowStatusIndicatorClass(segmentStatus: Segment['status']): string {
  return segmentStatus === 'confirmed'
    ? 'border-status-confirmed bg-status-confirmed'
    : 'border-status-empty bg-transparent';
}

export function getEditorRowStatusTitle(
  segmentStatus: Segment['status'],
  hasQaIssues: boolean,
): string {
  if (hasQaIssues) return `Status: ${segmentStatus} (QA problems)`;
  return `Status: ${segmentStatus}`;
}

export function getEditorRowActionVisibility({
  isActive,
  sourceTagsCount,
  sourceEditorText,
  draftText,
}: EditorRowActionVisibilityInput): EditorRowActionVisibility {
  const canInsertTags = sourceTagsCount > 0;
  const canAITranslate = sourceEditorText.trim().length > 0;
  const hasRefinableTarget = hasRefinableTargetText(draftText);
  const showTargetActionButtons =
    isActive && (canInsertTags || canAITranslate || hasRefinableTarget);
  return {
    canInsertTags,
    canAITranslate,
    hasRefinableTarget,
    showTargetActionButtons,
  };
}

export function buildEditorRowDisplayModel({
  segmentStatus,
  qaIssues,
  isActive,
  draftText,
  sourceEditorText,
  sourceTagsCount,
  sourceHighlightQuery,
  qaHighlights = [],
  highlightMode,
}: UseEditorRowDisplayModelParams): EditorRowDisplayModel {
  const statusIndicatorClass = getEditorRowStatusIndicatorClass(segmentStatus);
  const statusTitle = getEditorRowStatusTitle(segmentStatus, qaIssues.length > 0);

  const sourceDisplayText = sourceEditorText;
  const sourceHighlightChunks = buildEditorHighlightChunks(
    sourceEditorText,
    sourceHighlightQuery,
    highlightMode,
    qaHighlights,
  );
  const { canInsertTags, canAITranslate, hasRefinableTarget, showTargetActionButtons } =
    getEditorRowActionVisibility({
      isActive,
      sourceTagsCount,
      sourceEditorText,
      draftText,
    });

  return {
    statusIndicatorClass,
    statusTitle,
    sourceHighlightChunks,
    sourceDisplayText,
    canInsertTags,
    canAITranslate,
    hasRefinableTarget,
    showTargetActionButtons,
  };
}

export function useEditorRowDisplayModel(
  params: UseEditorRowDisplayModelParams,
): EditorRowDisplayModel {
  const {
    segmentStatus,
    qaIssues,
    isActive,
    draftText,
    sourceEditorText,
    sourceTagsCount,
    sourceHighlightQuery,
    qaHighlights,
    highlightMode,
    showNonPrintingSymbols,
  } = params;

  return useMemo(
    () =>
      buildEditorRowDisplayModel({
        segmentStatus,
        qaIssues,
        isActive,
        draftText,
        sourceEditorText,
        sourceTagsCount,
        sourceHighlightQuery,
        qaHighlights,
        highlightMode,
        showNonPrintingSymbols,
      }),
    [
      segmentStatus,
      qaIssues,
      isActive,
      draftText,
      sourceEditorText,
      sourceTagsCount,
      sourceHighlightQuery,
      qaHighlights,
      highlightMode,
      showNonPrintingSymbols,
    ],
  );
}

export type {
  EditorRowActionVisibility,
  EditorRowActionVisibilityInput,
  EditorRowDisplayModel,
  UseEditorRowDisplayModelParams,
};
