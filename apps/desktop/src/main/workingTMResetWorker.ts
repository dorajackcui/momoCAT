import { parentPort, workerData } from 'worker_threads';
import { CATDatabase } from '@cat/db';
import type { WorkingTMResetWorkerInput } from './services/modules/tm/WorkingTMResetWorkerRunner';

const port = parentPort;
if (!port) {
  throw new Error('Working TM reset worker requires parentPort');
}

const run = (): number => {
  const input = workerData as WorkingTMResetWorkerInput;
  const db = new CATDatabase(input.dbPath);

  try {
    return db.clearTMEntries(input.tmId);
  } finally {
    db.close();
  }
};

try {
  const removed = run();
  port.postMessage({ type: 'done', result: removed });
} catch (error: unknown) {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  port.postMessage({ type: 'error', error: message });
}
