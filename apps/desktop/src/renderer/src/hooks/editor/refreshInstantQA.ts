import { apiClient } from '../../services/apiClient';
import { feedbackService } from '../../services/feedbackService';
import type { EditorSegmentChange, EditorSegmentStore } from './editorSegmentStore';

/** Advisory follow-up: never awaited by confirmation or used to change its outcome. */
export async function refreshInstantQA(
  segmentIds: readonly string[],
  store: EditorSegmentStore,
  publishChanges: (changes: EditorSegmentChange[]) => void,
): Promise<void> {
  const revision = store.getQARevision();
  try {
    for (const id of segmentIds) {
      if (store.getQARevision() !== revision) return;
      const result = await apiClient.checkSegmentQA(id);
      if (store.getQARevision() !== revision) return;
      if (!result || result.stale) continue;
      const current = store.getSegment(id);
      if (
        !current ||
        JSON.stringify(current.targetTokens) !== JSON.stringify(result.segment.targetTokens)
      )
        continue;
      publishChanges(
        store.applyUpdates(new Map([[id, { ...current, qaIssues: result.segment.qaIssues }]])),
      );
    }
  } catch (error) {
    if (store.getQARevision() !== revision) return;
    feedbackService.info(
      `Instant QA failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
