import { parentPort, workerData } from 'worker_threads';
import { CATDatabase } from '@cat/db';
import { LocalizationSourceTerminologyPrechecker } from '@cat/localization';
import { SqliteSettingsRepository } from './services/adapters/SqliteSettingsRepository';
import { AISettingsService } from './services/modules/ai/AISettingsService';
import { ProxySettingsManager } from './services/proxy/ProxySettingsManager';
import type {
  SourceTerminologyPrecheckWorkerInput,
  SourceTerminologyPrecheckWorkerMessage,
} from './services/sourceTerminologyPrecheck/types';

const port = parentPort;
if (!port) {
  throw new Error('Source terminology precheck worker requires parentPort');
}

const PROGRESS_INTERVAL_MS = 100;
const postMessage = (message: SourceTerminologyPrecheckWorkerMessage) => port.postMessage(message);
let cancelRequested = false;
port.on('message', (message: unknown) => {
  if (message && typeof message === 'object' && (message as { type?: string }).type === 'cancel') {
    cancelRequested = true;
  }
});

const run = async () => {
  const input = workerData as SourceTerminologyPrecheckWorkerInput;
  const db = new CATDatabase(input.dbPath, { readonly: true, fileMustExist: true });

  try {
    new AISettingsService(
      new SqliteSettingsRepository(db),
      new ProxySettingsManager(),
    ).applySavedProxySettings();
    const prechecker = new LocalizationSourceTerminologyPrechecker(db);
    let lastEmitAt = 0;
    const result = await prechecker.precheckFile({
      ...input.precheckInput,
      cancellationToken: { isCancellationRequested: () => cancelRequested },
      onProgress: (current, total) => {
        const now = Date.now();
        if (current !== 0 && current !== total && now - lastEmitAt < PROGRESS_INTERVAL_MS) return;
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
