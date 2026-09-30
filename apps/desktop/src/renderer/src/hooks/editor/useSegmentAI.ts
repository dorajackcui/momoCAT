import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { normalizeSegmentStatus, type Segment } from '@cat/core/models';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { AISegmentTranslateResult } from '../../../../shared/ipc';
import { apiClient } from '../../services/apiClient';
import type { EditorSegmentStore, EditorSegmentChange } from './editorSegmentStore';
import type { SegmentOperation } from './useSegmentPersistence';

export function applyAISegmentTranslateResultToStore(
  store: EditorSegmentStore,
  result: AISegmentTranslateResult,
  accept: (id: string) => boolean = () => true,
): EditorSegmentChange[] {
  const updates = new Map<string, Segment>();
  const translatedSegment = store.getSegment(result.segmentId);
  if (translatedSegment && accept(result.segmentId)) {
    updates.set(result.segmentId, {
      ...translatedSegment,
      targetTokens: result.targetTokens,
      status: normalizeSegmentStatus(result.status, result.targetTokens),
      qaIssues: translatedSegment.qaIssues,
    });
  }

  for (const propagatedId of result.propagatedIds ?? []) {
    if (propagatedId === result.segmentId) continue;
    const propagatedSegment = store.getSegment(propagatedId);
    if (!propagatedSegment || !accept(propagatedId)) continue;
    updates.set(propagatedId, {
      ...propagatedSegment,
      targetTokens: result.targetTokens,
      status: normalizeSegmentStatus('draft', result.targetTokens),
      qaIssues: propagatedSegment.qaIssues,
    });
  }

  return store.applyUpdates(updates);
}

interface Params {
  fileId: number | null;
  store: EditorSegmentStore;
  flushSegment: (id: string) => Promise<void>;
  beginOperation: (id: string) => SegmentOperation;
  setSaveError: (id: string, message: string) => void;
  clearSaveError: (id: string) => void;
}

export function useSegmentAI({
  fileId,
  store,
  flushSegment,
  beginOperation,
  setSaveError,
  clearSaveError,
}: Params) {
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const running = useRef(new Set<string>());
  const scope = useRef(0);
  useLayoutEffect(() => {
    running.current.clear();
    setBusy({});
    return () => {
      scope.current += 1;
    };
  }, [fileId]);
  const run = useCallback(
    async (id: string, instruction?: string) => {
      if (running.current.has(id)) return;
      const segment = store.getSegment(id);
      if (!segment || segment.fileId !== fileId) return;
      const label = instruction === undefined ? 'AI 翻译失败' : 'AI 微调失败';
      if (!serializeTokensToDisplayText(segment.sourceTokens).trim()) {
        setSaveError(id, `${label}：源文为空`);
        return;
      }
      if (instruction !== undefined && !instruction.trim()) {
        setSaveError(id, `${label}：微调指示不能为空`);
        return;
      }
      const version = scope.current;
      const order = store.getOrderIds();
      const inScope = () => version === scope.current && store.getOrderIds() === order;
      running.current.add(id);
      setBusy((previous) => ({ ...previous, [id]: true }));
      clearSaveError(id);
      let operation: SegmentOperation | undefined;
      try {
        await flushSegment(id);
        if (!inScope()) return;
        operation = beginOperation(id);
        const result =
          instruction === undefined
            ? await apiClient.aiTranslateSegment(id, operation.clientRequestId)
            : await apiClient.aiRefineSegment(id, instruction.trim(), operation.clientRequestId);
        if (inScope()) applyAISegmentTranslateResultToStore(store, result, operation.isCurrent);
      } catch (error) {
        if (inScope() && (!operation || operation.isCurrent()))
          setSaveError(id, `${label}：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        if (version === scope.current) {
          running.current.delete(id);
          setBusy((previous) => {
            const next = { ...previous };
            delete next[id];
            return next;
          });
        }
      }
    },
    [fileId, store, flushSegment, beginOperation, setSaveError, clearSaveError],
  );
  const translateSegmentWithAI = useCallback((id: string) => run(id), [run]);
  const refineSegmentWithAI = useCallback(
    (id: string, instruction: string) => run(id, instruction),
    [run],
  );
  return { aiTranslatingSegmentIds: busy, translateSegmentWithAI, refineSegmentWithAI };
}
