import { describe, expect, it, vi } from 'vitest';
import {
  createAIFileJobTracker,
  upsertAIFileJobFromProgress,
  upsertAIFileJobOnStart,
} from './aiFileJobs';

describe('AI file job tracking', () => {
  it('keeps progress when file ownership is attached after a progress event', () => {
    const progressOnly = upsertAIFileJobFromProgress({
      jobId: 'job-1',
      progress: 42,
      status: 'running',
      message: 'Translating segment 4 of 10',
    });

    const attached = upsertAIFileJobOnStart('job-1', 12, progressOnly);

    expect(attached).toEqual({
      kind: 'ai-translate-file',
      jobId: 'job-1',
      fileId: 12,
      progress: 42,
      status: 'running',
      message: 'Translating segment 4 of 10',
    });
  });

  it('keeps terminal status when file ownership is attached after completion', () => {
    const completed = upsertAIFileJobFromProgress({
      jobId: 'job-2',
      progress: 100,
      status: 'completed',
      message: 'Done',
    });

    const attached = upsertAIFileJobOnStart('job-2', 34, completed);

    expect(attached).toEqual({
      kind: 'ai-translate-file',
      jobId: 'job-2',
      fileId: 34,
      progress: 100,
      status: 'completed',
      message: 'Done',
    });
  });
});

describe('createAIFileJobTracker', () => {
  it('resolves file jobs after tracking start and applying progress', () => {
    const tracker = createAIFileJobTracker();

    tracker.trackFileJobStart(12, 'job-1');
    tracker.applyProgress({
      jobId: 'job-1',
      progress: 40,
      status: 'running',
      message: 'Translating segment 4 of 10',
    });

    expect(tracker.getFileJob(12)).toMatchObject({
      jobId: 'job-1',
      fileId: 12,
      progress: 40,
      status: 'running',
    });
    expect(tracker.getJob('job-1')).toBe(tracker.getFileJob(12));
    expect(tracker.getFileJob(99)).toBeNull();
  });

  it('keeps progress arriving before file ownership is attached', () => {
    const tracker = createAIFileJobTracker();

    tracker.applyProgress({
      jobId: 'job-1',
      progress: 42,
      status: 'running',
      message: 'Translating segment 4 of 10',
    });
    tracker.trackFileJobStart(12, 'job-1');

    expect(tracker.getFileJob(12)).toMatchObject({
      jobId: 'job-1',
      fileId: 12,
      progress: 42,
      status: 'running',
    });
  });

  it('notifies subscribers on every update and stops after unsubscribe', () => {
    const tracker = createAIFileJobTracker();
    const listener = vi.fn();
    const unsubscribe = tracker.subscribe(listener);

    tracker.trackFileJobStart(12, 'job-1');
    tracker.applyProgress({ jobId: 'job-1', progress: 10, status: 'running' });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    tracker.applyProgress({ jobId: 'job-1', progress: 20, status: 'running' });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps unrelated job snapshots referentially stable across updates', () => {
    const tracker = createAIFileJobTracker();
    tracker.trackFileJobStart(12, 'job-1');
    tracker.trackFileJobStart(34, 'job-2');
    const fileJobBefore = tracker.getFileJob(12);

    tracker.applyProgress({ jobId: 'job-2', progress: 50, status: 'running' });

    expect(tracker.getFileJob(12)).toBe(fileJobBefore);
    expect(tracker.getFileJob(34)).toMatchObject({ progress: 50 });
  });
});
