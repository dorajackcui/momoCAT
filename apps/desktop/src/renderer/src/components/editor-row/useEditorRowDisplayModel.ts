import type { Segment } from '@cat/core/models';
import { useMemo } from 'react';
import { buildHighlightChunks, EditorMatchMode } from '../editorFilterUtils';
import {
  hasRefinableTargetText,
  shouldShowAIRefineControl,
  visualizeNonPrintingSymbols,
} from './editorRowUtils';

interface UseEditorRowDisplayModelParams {
  segmentStatus: Segment['status'];
  qaIssues: NonNullable<Segment['qaIssues']>;
  isActive: boolean;
  draftText: string;
  sourceEditorText: string;
  sourceTagsCount: number;
  sourceHighlightQuery: string;
  highlightMode: EditorMatchMode;
  showNonPrintingSymbols: boolean;
}

interface EditorRowDisplayModel {
  statusLine: string;
  statusTitle: string;
  sourceHighlightChunks: ReturnType<typeof buildHighlightChunks>;
  sourceDisplayText: string;
  canInsertTags: boolean;
  canAITranslate: boolean;
  hasRefinableTarget: boolean;
  showAIRefineControl: boolean;
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

export function getEditorRowStatusLineClass(
  segmentStatus: Segment['status'],
  hasError: boolean,
  hasWarning: boolean,
): string {
  if (hasError) return 'bg-danger';
  if (hasWarning) return 'bg-warning';

  if (segmentStatus === 'confirmed') return 'bg-success';
  if (segmentStatus === 'reviewed') return 'bg-info';
  if (segmentStatus === 'translated') return 'bg-brand';
  if (segmentStatus === 'draft') return 'bg-warning';
  return 'bg-text-faint';
}

export function getEditorRowStatusTitle(
  segmentStatus: Segment['status'],
  hasError: boolean,
  hasWarning: boolean,
): string {
  if (hasError) return `Status: ${segmentStatus} (QA error)`;
  if (hasWarning) return `Status: ${segmentStatus} (QA warning)`;
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
  highlightMode,
  showNonPrintingSymbols,
}: UseEditorRowDisplayModelParams): EditorRowDisplayModel {
  const hasError = qaIssues.some((issue) => issue.severity === 'error');
  const hasWarning = qaIssues.some((issue) => issue.severity === 'warning');
  const statusLine = getEditorRowStatusLineClass(segmentStatus, hasError, hasWarning);
  const statusTitle = getEditorRowStatusTitle(segmentStatus, hasError, hasWarning);

  const sourceDisplayText = showNonPrintingSymbols
    ? visualizeNonPrintingSymbols(sourceEditorText)
    : sourceEditorText;
  const sourceDisplayQuery = showNonPrintingSymbols
    ? visualizeNonPrintingSymbols(sourceHighlightQuery)
    : sourceHighlightQuery;
  const sourceHighlightChunks = buildHighlightChunks(
    sourceDisplayText,
    sourceDisplayQuery,
    highlightMode,
  );
  const { canInsertTags, canAITranslate, hasRefinableTarget, showTargetActionButtons } =
    getEditorRowActionVisibility({
      isActive,
      sourceTagsCount,
      sourceEditorText,
      draftText,
    });
  const showAIRefineControl = shouldShowAIRefineControl(isActive, draftText);

  return {
    statusLine,
    statusTitle,
    sourceHighlightChunks,
    sourceDisplayText,
    canInsertTags,
    canAITranslate,
    hasRefinableTarget,
    showAIRefineControl,
    showTargetActionButtons,
  };
}

export function useEditorRowDisplayModel(
  params: UseEditorRowDisplayModelParams,
): EditorRowDisplayModel {
  return useMemo(
    () => buildEditorRowDisplayModel(params),
    [
      params.segmentStatus,
      params.qaIssues,
      params.isActive,
      params.draftText,
      params.sourceEditorText,
      params.sourceTagsCount,
      params.sourceHighlightQuery,
      params.highlightMode,
      params.showNonPrintingSymbols,
    ],
  );
}

export type {
  EditorRowActionVisibility,
  EditorRowActionVisibilityInput,
  EditorRowDisplayModel,
  UseEditorRowDisplayModelParams,
};
