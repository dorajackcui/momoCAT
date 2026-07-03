import { parentPort, workerData } from 'worker_threads';
import { CATDatabase } from '@cat/db';
import { LocalizationReferenceExporter } from '@cat/localization';
import type {
  ReferenceExportWorkerInput,
  ReferenceExportWorkerMessage,
} from './services/referenceExport/types';

const port = parentPort;
if (!port) {
  throw new Error('Reference export worker requires parentPort');
}

const PROGRESS_INTERVAL_MS = 100;

const postMessage = (message: ReferenceExportWorkerMessage) => {
  port.postMessage(message);
};

const run = async () => {
  const input = workerData as ReferenceExportWorkerInput;
  const db = new CATDatabase(input.dbPath, { readonly: true, fileMustExist: true });

  try {
    const exporter = new LocalizationReferenceExporter(db);
    let lastEmitAt = 0;

    const result = await exporter.exportReferencesForMtFile({
      ...input.exportInput,
      onProgress: (current, total) => {
        const now = Date.now();
        // Throttle intermediate progress; always deliver the first and final ticks.
        if (current !== 0 && current !== total && now - lastEmitAt < PROGRESS_INTERVAL_MS) {
          return;
        }
        lastEmitAt = now;
        postMessage({ type: 'progress', current, total });
      },
    });

    postMessage({
      type: 'done',
      result: { outputPath: result.outputPath, summary: result.summary },
    });
  } finally {
    db.close();
  }
};

run().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  postMessage({ type: 'error', error: message });
});
