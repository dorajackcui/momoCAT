import type { Segment } from '@cat/core/models';
import { apiClient } from '../../services/apiClient';
import { feedbackService } from '../../services/feedbackService';
import type { EditorSegmentStore } from './editorSegmentStore';

/** Advisory follow-up: never awaited by confirmation or used to change its outcome. */
export async function refreshInstantQA(
  segmentIds: readonly string[],
  store: EditorSegmentStore,
): Promise<void> {
  const revision = store.getQARevision();
  const findings = new Map<string, Segment['qaIssues']>();
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
      findings.set(id, result.segment.qaIssues);
    }
  } catch (error) {
    if (store.getQARevision() !== revision) return;
    feedbackService.info(
      `Instant QA failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    // Publish the selected confirmation follow-up once, preserving the latest row metadata.
    if (store.getQARevision() === revision)
      store.applyUpdates(
        new Map(
          [...findings].flatMap(([id, qaIssues]) => {
            const current = store.getSegment(id);
            return current && JSON.stringify(current.qaIssues) !== JSON.stringify(qaIssues)
              ? [[id, { ...current, qaIssues }]]
              : [];
          }),
        ),
      );
  }
}
