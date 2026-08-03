import type { CATDatabase } from '@cat/db';
import {
  LocalizationInspector,
  LocalizationReferenceExporter,
  type AIRuntimeConfigProvider,
  type AITransport,
} from '@cat/localization';
import { ReferenceExportWorkerRunner } from '../referenceExport/ReferenceExportWorkerRunner';
import type { InspectFileRunner, ReferenceExportRunner } from './ProjectReferenceFileOperations';

export function createInspectFileRunner(
  db: CATDatabase,
  dbPath: string,
  aiRuntimeConfigProvider?: AIRuntimeConfigProvider,
  aiTransport?: AITransport,
): InspectFileRunner {
  const inspector = new LocalizationInspector(db, { dbPath, aiRuntimeConfigProvider, aiTransport });
  return (input) => inspector.inspectFile(input);
}

export function createReferenceExportRunner(
  db: CATDatabase,
  dbPath: string,
): ReferenceExportRunner {
  const workerRunner = new ReferenceExportWorkerRunner({
    dbPath,
    fallbackRunner: (input) =>
      new LocalizationReferenceExporter(db).exportReferencesForMtFile(input),
  });
  return (input) => workerRunner.run(input);
}
