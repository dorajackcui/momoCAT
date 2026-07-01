import { describe, expect, it, vi } from 'vitest';
import { JobManager } from './JobManager';

describe('JobManager cancellation', () => {
  it('marks a running job as cancel requested and exposes it through a token', () => {
    const jobManager = new JobManager();
    const progressEvents: unknown[] = [];
    jobManager.on('progress', (progress) => progressEvents.push({ ...progress }));

    jobManager.startJob('job-1', 'AI translation started');
    const token = jobManager.getCancellationToken('job-1');

    expect(token.isCancellationRequested()).toBe(false);
    expect(jobManager.cancelJob('job-1')).toBe(true);

    expect(token.isCancellationRequested()).toBe(true);
    expect(jobManager.getJob('job-1')).toEqual(
      expect.objectContaining({
        status: 'running',
        cancelRequested: true,
        message: 'Stopping...',
      }),
    );
    expect(progressEvents).toContainEqual(
      expect.objectContaining({
        jobId: 'job-1',
        status: 'running',
        cancelRequested: true,
        message: 'Stopping...',
      }),
    );
  });

  it('does not cancel terminal or missing jobs', () => {
    const jobManager = new JobManager();
    const progress = vi.fn();
    jobManager.on('progress', progress);

    jobManager.startJob('job-1');
    jobManager.updateProgress('job-1', { status: 'completed', progress: 100 });

    expect(jobManager.cancelJob('job-1')).toBe(false);
    expect(jobManager.cancelJob('missing-job')).toBe(false);
  });
});
