import { describe, expect, it, vi } from 'vitest';
import {
  shouldInvalidateReferenceLookupWorkerCaches,
  subscribeToWorkingTMReferenceDataChanges,
} from './referenceDataInvalidation';

describe('subscribeToWorkingTMReferenceDataChanges', () => {
  it('maps a committed Working TM update to project-scoped reference invalidation', () => {
    let listener: ((event: { projectId: number; srcHash: string }) => void) | undefined;
    const unsubscribe = vi.fn();
    const source = {
      onWorkingTMUpdated: vi.fn(
        (callback: (event: { projectId: number; srcHash: string }) => void) => {
          listener = callback;
          return unsubscribe;
        },
      ),
    };
    const notify = vi.fn();

    const dispose = subscribeToWorkingTMReferenceDataChanges(source, notify);
    listener?.({ projectId: 7, srcHash: 'hash-source' });

    expect(notify).toHaveBeenCalledWith({
      projectId: 7,
      kind: 'tm',
      reason: 'working-tm-updated',
      srcHash: 'hash-source',
    });

    dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('does not invalidate TB worker indexes for a Working TM-only update', () => {
    expect(
      shouldInvalidateReferenceLookupWorkerCaches({
        projectId: 7,
        kind: 'tm',
        reason: 'working-tm-updated',
        srcHash: 'hash-source',
      }),
    ).toBe(false);
    expect(
      shouldInvalidateReferenceLookupWorkerCaches({
        projectId: 7,
        kind: 'tm',
        reason: 'working-tm-reset',
      }),
    ).toBe(true);
    expect(
      shouldInvalidateReferenceLookupWorkerCaches({
        projectId: 7,
        kind: 'tb',
        reason: 'tb-synced',
      }),
    ).toBe(true);
  });
});
