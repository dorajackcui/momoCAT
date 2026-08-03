import type { CATDatabase } from '@cat/db';
import {
  LocalizationSourceTerminologyPrechecker,
  type AIRuntimeConfigProvider,
  type AITransport,
} from '@cat/localization';
import { SourceTerminologyPrecheckWorkerRunner } from './SourceTerminologyPrecheckWorkerRunner';
import type { SourceTerminologyPrecheckRunner } from './types';

export function createSourceTerminologyPrecheckRunner(
  db: CATDatabase,
  dbPath: string,
  aiRuntimeConfigProvider?: AIRuntimeConfigProvider,
  aiTransport?: AITransport,
): SourceTerminologyPrecheckRunner {
  const workerRunner = new SourceTerminologyPrecheckWorkerRunner({
    dbPath,
    fallbackRunner: (input) =>
      new LocalizationSourceTerminologyPrechecker(db, {
        aiRuntimeConfigProvider,
        aiTransport,
      }).precheckFile(input),
  });
  return (input) => workerRunner.run(input);
}
