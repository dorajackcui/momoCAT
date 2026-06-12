import { describe, expect, it } from 'vitest';
import { upsertAIFileJobFromProgress, upsertAIFileJobOnStart } from './aiFileJobs';

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
