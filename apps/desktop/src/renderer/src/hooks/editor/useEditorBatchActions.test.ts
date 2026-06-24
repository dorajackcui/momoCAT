import { describe, expect, it, vi } from 'vitest';

vi.mock('../../services/apiClient', () => ({
  apiClient: {},
}));

vi.mock('../../services/feedbackService', () => ({
  feedbackService: {},
}));

import { exportEditorFile } from './useEditorBatchActions';

describe('exportEditorFile', () => {
  function createFeedback() {
    return {
      success: vi.fn(),
      error: vi.fn(),
      confirm: vi.fn(),
    };
  }

  it('flushes pending segment updates before opening the save dialog and exporting', async () => {
    const order: string[] = [];
    const flushPendingSegmentUpdates = vi.fn(async () => {
      order.push('flush');
    });
    const api = {
      saveFileDialog: vi.fn(async () => {
        order.push('dialog');
        return 'translated.csv';
      }),
      exportFile: vi.fn(async () => {
        order.push('export');
      }),
    };
    const feedback = createFeedback();

    await exportEditorFile({
      fileId: 7,
      fileName: 'source.csv',
      flushPendingSegmentUpdates,
      api,
      feedback,
    });

    expect(order).toEqual(['flush', 'dialog', 'export']);
    expect(api.exportFile).toHaveBeenCalledWith(7, 'translated.csv');
    expect(feedback.success).toHaveBeenCalledWith('Export successful');
  });

  it('does not flush or export when file name is missing', async () => {
    const flushPendingSegmentUpdates = vi.fn();
    const api = {
      saveFileDialog: vi.fn(),
      exportFile: vi.fn(),
    };

    await exportEditorFile({
      fileId: 7,
      fileName: null,
      flushPendingSegmentUpdates,
      api,
      feedback: createFeedback(),
    });

    expect(flushPendingSegmentUpdates).not.toHaveBeenCalled();
    expect(api.saveFileDialog).not.toHaveBeenCalled();
    expect(api.exportFile).not.toHaveBeenCalled();
  });

  it('does not export when the save dialog is cancelled after flushing edits', async () => {
    const flushPendingSegmentUpdates = vi.fn(async () => undefined);
    const api = {
      saveFileDialog: vi.fn(async () => null),
      exportFile: vi.fn(),
    };

    await exportEditorFile({
      fileId: 7,
      fileName: 'source.csv',
      flushPendingSegmentUpdates,
      api,
      feedback: createFeedback(),
    });

    expect(flushPendingSegmentUpdates).toHaveBeenCalledTimes(1);
    expect(api.exportFile).not.toHaveBeenCalled();
  });

  it('stops export with a save-specific error when pending edits fail to flush', async () => {
    const flushPendingSegmentUpdates = vi.fn(async () => {
      throw new Error('disk unavailable');
    });
    const api = {
      saveFileDialog: vi.fn(),
      exportFile: vi.fn(),
    };
    const feedback = createFeedback();

    await exportEditorFile({
      fileId: 7,
      fileName: 'source.csv',
      flushPendingSegmentUpdates,
      api,
      feedback,
    });

    expect(api.saveFileDialog).not.toHaveBeenCalled();
    expect(api.exportFile).not.toHaveBeenCalled();
    expect(feedback.error).toHaveBeenCalledWith(
      'Failed to save pending segment edits before export: disk unavailable',
    );
  });

  it('supports forced export after QA blocks the first export attempt', async () => {
    const api = {
      saveFileDialog: vi.fn(async () => 'translated.csv'),
      exportFile: vi
        .fn()
        .mockRejectedValueOnce(new Error('Export blocked by QA errors: 2 issues'))
        .mockResolvedValueOnce(undefined),
    };
    const feedback = createFeedback();
    feedback.confirm.mockResolvedValue(true);

    await exportEditorFile({
      fileId: 7,
      fileName: 'source.csv',
      flushPendingSegmentUpdates: vi.fn(async () => undefined),
      api,
      feedback,
    });

    expect(api.exportFile).toHaveBeenNthCalledWith(1, 7, 'translated.csv');
    expect(api.exportFile).toHaveBeenNthCalledWith(2, 7, 'translated.csv', undefined, true);
    expect(feedback.success).toHaveBeenCalledWith('Export successful (forced despite QA errors)');
  });
});
