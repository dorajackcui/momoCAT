import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { normalizeSegmentStatus, type Segment } from '@cat/core/models';
import { serializeTokensToEditorText, type TagPolicy } from '@cat/core/tag';
import type { SelectedSegmentUpdate, SegmentsUpdatedEvent } from '../../../../shared/ipc';
import { apiClient } from '../../services/apiClient';
import { feedbackService } from '../../services/feedbackService';
import { parseTargetEditorText } from './editorTokenPolicy';

export type SelectedSegmentAction = 'clear' | 'copy-source' | 'confirm';

interface Params {
  fileId: number | null;
  getSegment: (id: string) => Segment | undefined;
  flushPending: () => Promise<void>;
  applyUpdates: (events: SegmentsUpdatedEvent[]) => void;
  onConfirmed: (segmentIds: string[]) => void;
  clearSaveError: (id: string) => void;
  tagPolicy: TagPolicy;
}

export function useSelectedSegmentActions({
  fileId,
  getSegment,
  flushPending,
  applyUpdates,
  onConfirmed,
  clearSaveError,
  tagPolicy,
}: Params) {
  const [isRunning, setIsRunning] = useState(false);
  const running = useRef(false);
  const scope = useRef(0);
  useLayoutEffect(() => {
    running.current = false;
    setIsRunning(false);
    return () => {
      scope.current += 1;
    };
  }, [fileId]);
  const run = useCallback(
    async (
      action: SelectedSegmentAction | 'paste',
      segmentIds: string[],
      targetTexts?: string[],
    ) => {
      if (running.current || fileId === null || segmentIds.length === 0) return;
      const ids = [...new Set(segmentIds)];
      const texts = targetTexts ? [...targetTexts] : undefined;
      const scopeVersion = scope.current;
      running.current = true;
      setIsRunning(true);
      try {
        if (action === 'paste' && texts?.length !== ids.length)
          throw new Error('Paste row count must match the selected segments');
        await flushPending();
        if (scopeVersion !== scope.current) return;
        const updates: SelectedSegmentUpdate[] = [];
        for (const [index, id] of ids.entries()) {
          const segment = getSegment(id);
          if (!segment || segment.fileId !== fileId)
            throw new Error('Selected segment is unavailable');
          if (action === 'confirm') {
            updates.push({
              segmentId: id,
              targetTokens: segment.targetTokens,
              status: 'confirmed',
            });
          } else {
            const targetTokens =
              action === 'clear' || (action === 'paste' && texts![index] === '')
                ? []
                : parseTargetEditorText(
                    action === 'paste'
                      ? texts![index]
                      : serializeTokensToEditorText(segment.sourceTokens, segment.sourceTokens),
                    segment.sourceTokens,
                    tagPolicy,
                  );
            updates.push({
              segmentId: id,
              targetTokens,
              status: normalizeSegmentStatus('draft', targetTokens),
            });
          }
        }
        if (updates.length) {
          const events = await apiClient.updateSelectedSegments(fileId, updates);
          if (scopeVersion !== scope.current) return;
          applyUpdates(events);
          for (const update of updates) clearSaveError(update.segmentId);
          if (action === 'confirm') onConfirmed(updates.map((update) => update.segmentId));
        }
        const label =
          action === 'confirm'
            ? 'Confirmed'
            : action === 'clear'
              ? 'Cleared'
              : action === 'paste'
                ? 'Pasted into'
                : 'Copied source to';
        feedbackService.success(`${label} ${updates.length} segments.`);
      } catch (error) {
        if (scopeVersion !== scope.current) return;
        feedbackService.error(
          `Selected segment action failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        if (scopeVersion === scope.current) {
          running.current = false;
          setIsRunning(false);
        }
      }
    },
    [applyUpdates, clearSaveError, fileId, flushPending, getSegment, onConfirmed, tagPolicy],
  );
  const pasteSelectedSegments = useCallback(
    (ids: string[], targets: string[]) => run('paste', ids, targets),
    [run],
  );
  return {
    runSelectedSegmentAction: run,
    pasteSelectedSegments,
    isSelectedSegmentActionRunning: isRunning,
  };
}
