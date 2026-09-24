import { useCallback, useLayoutEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Segment } from '@cat/core/models';
import type { SegmentsUpdatedEvent } from '../../../../shared/ipc';
import { apiClient } from '../../services/apiClient';
import type { SetSegmentsWithChangeHint } from './editorSegmentState';

interface UseSegmentConfirmationParams {
  segments: Segment[];
  setSegments: SetSegmentsWithChangeHint;
  setActiveSegmentId: Dispatch<SetStateAction<string | null>>;
  setSegmentSaveError: (segmentId: string, message: string) => void;
  clearSegmentSaveError: (segmentId: string) => void;
  onConfirmed: (data: SegmentsUpdatedEvent) => void;
}

export function useSegmentConfirmation({
  segments,
  setSegments,
  setActiveSegmentId,
  setSegmentSaveError,
  clearSegmentSaveError,
  onConfirmed,
}: UseSegmentConfirmationParams): { confirmSegment: (segmentId: string) => Promise<void> } {
  // Read frequently-changing inputs through a ref so confirmSegment keeps a
  // stable identity (it is forwarded to every EditorRow as onConfirm).
  const workflowInputsRef = useRef({
    segments,
  });
  useLayoutEffect(() => {
    workflowInputsRef.current = {
      segments,
    };
  }, [segments]);

  const confirmSegment = useCallback(
    async (segmentId: string) => {
      const { segments } = workflowInputsRef.current;
      const segment = segments.find((item) => item.segmentId === segmentId);
      if (!segment) return;
      const previousStatus = segment.status;
      setSegments(
        (prev) =>
          prev.map((item) =>
            item.segmentId === segmentId
              ? {
                  ...item,
                  status: 'confirmed',
                }
              : item,
          ),
        { orderChanged: false, changedSegmentIds: [segmentId] },
      );
      clearSegmentSaveError(segmentId);

      try {
        const result = await apiClient.updateSegment(segmentId, segment.targetTokens, 'confirmed');
        onConfirmed({
          ...result,
          segmentId,
          targetTokens: segment.targetTokens,
          status: 'confirmed',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setSegments(
          (prev) =>
            prev.map((item) =>
              item.segmentId === segmentId
                ? {
                    ...item,
                    status: previousStatus,
                  }
                : item,
            ),
          { orderChanged: false, changedSegmentIds: [segmentId] },
        );
        setSegmentSaveError(segmentId, `保存失败：${message}`);
        return;
      }

      const currentIndex = segments.findIndex((item) => item.segmentId === segmentId);
      if (currentIndex < segments.length - 1) {
        setActiveSegmentId(segments[currentIndex + 1].segmentId);
      }
    },
    [clearSegmentSaveError, onConfirmed, setActiveSegmentId, setSegmentSaveError, setSegments],
  );

  return {
    confirmSegment,
  };
}
