import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SegmentsUpdatedPayload } from '../services/ports';

const mockSend = vi.fn();
const mockGetAllWindows = vi.fn(() => [{ webContents: { send: mockSend } }]);

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => mockGetAllWindows() },
}));

import { SegmentUpdateBatcher } from './SegmentUpdateBatcher';

function createPayload(segmentId: string): SegmentsUpdatedPayload {
  return {
    fileId: 1,
    segmentId,
    targetTokens: [{ type: 'text', content: `target-${segmentId}` }],
    status: 'draft',
    propagatedIds: [],
    serverAppliedAt: '2026-06-30T00:00:00.000Z',
  };
}

describe('SegmentUpdateBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSend.mockClear();
    mockGetAllWindows.mockClear();
    mockGetAllWindows.mockReturnValue([{ webContents: { send: mockSend } }]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a single batch after the 50ms window', () => {
    const batcher = new SegmentUpdateBatcher();
    const payload = createPayload('seg-1');

    batcher.enqueue(payload);
    expect(mockSend).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith('segments-updated-batch', [payload]);
  });

  it('collects multiple events within the same window into one batch', () => {
    const batcher = new SegmentUpdateBatcher();
    const p1 = createPayload('seg-1');
    const p2 = createPayload('seg-2');
    const p3 = createPayload('seg-3');

    batcher.enqueue(p1);
    vi.advanceTimersByTime(10);
    batcher.enqueue(p2);
    vi.advanceTimersByTime(20);
    batcher.enqueue(p3);

    expect(mockSend).not.toHaveBeenCalled();

    vi.advanceTimersByTime(20);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith('segments-updated-batch', [p1, p2, p3]);
  });

  it('separates events across distinct time windows', () => {
    const batcher = new SegmentUpdateBatcher();
    const p1 = createPayload('seg-1');
    const p2 = createPayload('seg-2');

    batcher.enqueue(p1);
    vi.advanceTimersByTime(50);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith('segments-updated-batch', [p1]);

    mockSend.mockClear();
    batcher.enqueue(p2);
    vi.advanceTimersByTime(50);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith('segments-updated-batch', [p2]);
  });

  it('broadcasts to all open windows', () => {
    const send1 = vi.fn();
    const send2 = vi.fn();
    mockGetAllWindows.mockReturnValue([
      { webContents: { send: send1 } },
      { webContents: { send: send2 } },
    ]);

    const batcher = new SegmentUpdateBatcher();
    const payload = createPayload('seg-1');
    batcher.enqueue(payload);
    vi.advanceTimersByTime(50);

    expect(send1).toHaveBeenCalledWith('segments-updated-batch', [payload]);
    expect(send2).toHaveBeenCalledWith('segments-updated-batch', [payload]);
  });

  it('does not send when buffer is empty', () => {
    const batcher = new SegmentUpdateBatcher();
    batcher.dispose();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('dispose flushes pending buffer immediately', () => {
    const batcher = new SegmentUpdateBatcher();
    const p1 = createPayload('seg-1');
    const p2 = createPayload('seg-2');

    batcher.enqueue(p1);
    batcher.enqueue(p2);
    expect(mockSend).not.toHaveBeenCalled();

    batcher.dispose();
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith('segments-updated-batch', [p1, p2]);

    vi.advanceTimersByTime(100);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
