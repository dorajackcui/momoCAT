import { describe, expect, it, vi } from 'vitest';
import {
  buildAIStartConfirmMessage,
  resolveAITranslateStartConfig,
} from './ai/useProjectAIController';
import { upsertTrackedJobFromProgress, upsertTrackedJobOnStart } from './ai/aiJobTracker';

vi.mock('../../services/apiClient', () => ({
  apiClient: {},
}));

vi.mock('../../services/feedbackService', () => ({
  feedbackService: {},
}));

describe('useProjectAI controller behaviors', () => {
  it('resolves target baseline for translation projects', () => {
    const config = resolveAITranslateStartConfig({
      projectType: 'translation',
      options: { targetBaseline: 'ignore-current-targets' },
    });

    expect(config).toMatchObject({
      effectiveTargetBaseline: 'ignore-current-targets',
      actionLabel: 'translation',
      targetLabel: 'target',
    });
  });

  it('forces default target baseline for non-translation projects', () => {
    const reviewConfig = resolveAITranslateStartConfig({
      projectType: 'review',
      options: { targetBaseline: 'ignore-current-targets' },
    });
    const customConfig = resolveAITranslateStartConfig({
      projectType: 'custom',
      options: { targetBaseline: 'use-current-targets' },
    });

    expect(reviewConfig).toMatchObject({
      effectiveMode: 'default',
      effectiveTargetBaseline: 'use-current-targets',
      actionLabel: 'review',
      targetLabel: 'target',
    });
    expect(customConfig).toMatchObject({
      effectiveMode: 'default',
      effectiveTargetBaseline: 'use-current-targets',
      actionLabel: 'processing',
      targetLabel: 'output',
    });
  });

  it('builds confirmation message with target baseline wording', () => {
    const message = buildAIStartConfirmMessage('demo.xlsx', {
      effectiveMode: 'default',
      effectiveTargetBaseline: 'ignore-current-targets',
      actionLabel: 'translation',
      targetLabel: 'target',
    });

    expect(message).toBe(
      'Run AI translation for "demo.xlsx"? This will ignore existing non-confirmed target segments and regenerate them.',
    );
  });

  it('keeps terminal status during start/progress race', () => {
    const started = upsertTrackedJobOnStart('job-race', 10);
    const completed = upsertTrackedJobFromProgress(
      {
        jobId: 'job-race',
        progress: 100,
        status: 'completed',
        message: 'Done',
      },
      started,
    );

    const lateStart = upsertTrackedJobOnStart('job-race', 10, completed);

    expect(lateStart).toEqual({
      kind: 'ai-translate-file',
      jobId: 'job-race',
      fileId: 10,
      progress: 100,
      status: 'completed',
      message: 'Done',
    });
  });
});
