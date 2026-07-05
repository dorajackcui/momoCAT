import { parentPort, workerData } from 'worker_threads';
import { CATDatabase } from '@cat/db';
import { runTMSyncPipeline } from './services/modules/tm/tmSyncPipeline';
import type { TMSyncPipelineInput } from './services/modules/tm/tmSyncPipeline';

export interface TMSyncWorkerInput extends TMSyncPipelineInput {
  dbPath: string;
}

const port = parentPort;
if (!port) {
  throw new Error('TM sync worker requires parentPort');
}

let cancelRequested = false;
port.on('message', (message: unknown) => {
  if (message && typeof message === 'object' && (message as { type?: string }).type === 'cancel') {
    cancelRequested = true;
  }
});

const run = async () => {
  const input = workerData as TMSyncWorkerInput;
  const db = new CATDatabase(input.dbPath);

  try {
    const report = await runTMSyncPipeline(db, input, {
      emitProgress: (percent, message) => {
        port.postMessage({
          type: 'progress',
          percent: Math.max(0, Math.min(Math.round(percent), 100)),
          message,
        });
      },
      isCancelled: () => cancelRequested,
      // Between chunked transactions: let queued messages (cancel) be processed.
      yieldBetweenChunks: () => new Promise<void>((resolve) => setImmediate(resolve)),
    });
    port.postMessage({ type: 'done', result: report });
  } finally {
    db.close();
  }
};

run().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  port.postMessage({ type: 'error', error: message });
});
