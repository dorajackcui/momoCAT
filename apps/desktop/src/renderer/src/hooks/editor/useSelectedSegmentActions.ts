import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { normalizeSegmentStatus, type Segment } from '@cat/core/models';
import { serializeTokensToEditorText, type TagPolicy } from '@cat/core/tag';
import type { SelectedSegmentUpdate, SegmentsUpdatedEvent } from '../../../../shared/ipc';
import { apiClient } from '../../services/apiClient';
import { feedbackService } from '../../services/feedbackService';
import { parseTargetEditorText } from './editorTokenPolicy';
import { checkSegmentConfirmation, type ConfirmationQaSettings } from './segmentConfirmationQa';
import type { SetSegmentsWithChangeHint } from './editorSegmentState';

export type SelectedSegmentAction = 'clear' | 'copy-source' | 'confirm';

interface Params {
  fileId: number | null;
  getSegment: (id: string) => Segment | undefined;
  flushPending: () => Promise<void>;
  applyUpdates: (events: SegmentsUpdatedEvent[]) => void;
  setSegments: SetSegmentsWithChangeHint;
  clearSaveError: (id: string) => void;
  tagPolicy: TagPolicy;
  qaSettings: ConfirmationQaSettings;
}

export function useSelectedSegmentActions({
  fileId,
  getSegment,
  flushPending,
  applyUpdates,
  setSegments,
  clearSaveError,
  tagPolicy,
  qaSettings,
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
    async (action: SelectedSegmentAction, segmentIds: string[]) => {
      if (running.current || fileId === null || segmentIds.length === 0) return;
      const ids = [...new Set(segmentIds)];
      const scopeVersion = scope.current;
      running.current = true;
      setIsRunning(true);
      try {
        await flushPending();
        if (scopeVersion !== scope.current) return;
        const updates: SelectedSegmentUpdate[] = [];
        const qaUpdates = new Map<string, Partial<Segment>>();
        let blockedCount = 0;
        for (const id of ids) {
          const segment = getSegment(id);
          if (!segment || segment.fileId !== fileId)
            throw new Error('Selected segment is unavailable');
          if (action === 'confirm') {
            const { blocked, ...qa } = await checkSegmentConfirmation(segment, qaSettings);
            if (scopeVersion !== scope.current) return;
            qaUpdates.set(id, qa);
            if (blocked) {
              blockedCount += 1;
              continue;
            }
            updates.push({
              segmentId: id,
              targetTokens: segment.targetTokens,
              status: 'confirmed',
            });
          } else {
            const targetTokens =
              action === 'clear'
                ? []
                : parseTargetEditorText(
                    serializeTokensToEditorText(segment.sourceTokens, segment.sourceTokens),
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
        if (qaUpdates.size) {
          setSegments(
            (prev) =>
              prev.map((segment) => {
                const qa = qaUpdates.get(segment.segmentId);
                return qa ? { ...segment, ...qa } : segment;
              }),
            { orderChanged: false, changedSegmentIds: [...qaUpdates.keys()] },
          );
        }
        if (updates.length) {
          const events = await apiClient.updateSelectedSegments(fileId, updates);
          if (scopeVersion !== scope.current) return;
          applyUpdates(events);
          for (const update of updates) clearSaveError(update.segmentId);
        }
        const label =
          action === 'confirm' ? 'Confirmed' : action === 'clear' ? 'Cleared' : 'Copied source to';
        const message = `${label} ${updates.length} segments.${blockedCount ? ` ${blockedCount} blocked by QA.` : ''}`;
        if (blockedCount) feedbackService.info(message);
        else feedbackService.success(message);
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
    [
      applyUpdates,
      clearSaveError,
      fileId,
      flushPending,
      getSegment,
      qaSettings,
      setSegments,
      tagPolicy,
    ],
  );
  return { runSelectedSegmentAction: run, isSelectedSegmentActionRunning: isRunning };
}
