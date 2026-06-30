import { BrowserWindow } from 'electron';
import type { SegmentsUpdatedPayload } from '../services/ports';
import { IPC_CHANNELS } from '../../shared/ipcChannels';

const BATCH_WINDOW_MS = 50;

export class SegmentUpdateBatcher {
  private buffer: SegmentsUpdatedPayload[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  enqueue(data: SegmentsUpdatedPayload): void {
    this.buffer.push(data);
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), BATCH_WINDOW_MS);
    }
  }

  private flush(): void {
    this.timer = null;
    const batch = this.buffer;
    this.buffer = [];
    if (batch.length === 0) return;

    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(IPC_CHANNELS.events.segmentsUpdatedBatch, batch);
    });
  }

  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
      const batch = this.buffer;
      this.buffer = [];
      if (batch.length === 0) return;

      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send(IPC_CHANNELS.events.segmentsUpdatedBatch, batch);
      });
    }
  }
}
