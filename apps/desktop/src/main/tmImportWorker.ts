import { parentPort, workerData } from 'worker_threads';
import { CATDatabase } from '@cat/db';
import { runTMImportPipeline } from './services/modules/tm/tmImportPipeline';
import type { TMImportOptions } from '../shared/ipc';

interface TMImportWorkerInput {
  dbPath: string;
  tmId: string;
  filePath: string;
  options: TMImportOptions;
}

const port = parentPort;
if (!port) {
  throw new Error('TM import worker requires parentPort');
}

const run = async () => {
  const input = workerData as TMImportWorkerInput;
  const db = new CATDatabase(input.dbPath);

  try {
    const result = await runTMImportPipeline(
      db,
      { tmId: input.tmId, filePath: input.filePath, options: input.options },
      {
        emitProgress: (current, total, message) => {
          port.postMessage({ type: 'progress', current, total, message });
        },
        yieldBetweenChunks: () => new Promise<void>((resolve) => setImmediate(resolve)),
      },
    );
    port.postMessage({ type: 'done', result });
  } finally {
    db.close();
  }
};

run().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  port.postMessage({ type: 'error', error: message });
});
