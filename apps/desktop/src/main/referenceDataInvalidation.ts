import type { ReferenceDataChangedEvent } from '../shared/ipc';

interface WorkingTMUpdateSource {
  onWorkingTMUpdated(callback: (event: { projectId: number; srcHash: string }) => void): () => void;
}

export function shouldInvalidateReferenceLookupWorkerCaches(
  event: ReferenceDataChangedEvent,
): boolean {
  return event.reason !== 'working-tm-updated';
}

export function subscribeToWorkingTMReferenceDataChanges(
  source: WorkingTMUpdateSource,
  notifyReferenceDataChanged: (event: ReferenceDataChangedEvent) => void,
): () => void {
  return source.onWorkingTMUpdated(({ projectId, srcHash }) => {
    notifyReferenceDataChanged({
      projectId,
      kind: 'tm',
      reason: 'working-tm-updated',
      srcHash,
    });
  });
}
