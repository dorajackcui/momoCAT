import { parentPort, workerData } from 'worker_threads';
import { CATDatabase } from '@cat/db';
import { runWorkingTMExportPipeline } from './services/modules/tm/workingTMExportPipeline';
import type { WorkingTMExportWorkerInput } from './services/modules/tm/WorkingTMExportWorkerRunner';

const port = parentPort;
if (!port) {
  throw new Error('Working TM export worker requires parentPort');
}

const run = async (): Promise<number> => {
  const input = workerData as WorkingTMExportWorkerInput;
  const db = new CATDatabase(input.dbPath, { readonly: true, fileMustExist: true });

  try {
    return await runWorkingTMExportPipeline(db, input);
  } finally {
    db.close();
  }
};

run()
  .then((exported) => port.postMessage({ type: 'done', result: exported }))
  .catch((error: unknown) => {
    const message =
      error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    port.postMessage({ type: 'error', error: message });
  });
