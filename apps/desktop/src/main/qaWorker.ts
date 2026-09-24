import { parentPort, workerData } from 'worker_threads';
import { CATDatabase } from '@cat/db';
import {
  runProjectFileQA,
  SqliteProjectRepository,
  SqliteTBRepository,
  TBService,
} from '@cat/localization';
import type { QAWorkerInput } from './services/qa/createQAFileRunner';

async function run() {
  const input = workerData as QAWorkerInput;
  const db = new CATDatabase(input.dbPath, { fileMustExist: true });
  try {
    const projectRepo = new SqliteProjectRepository(db);
    const terminology = new TBService(projectRepo, new SqliteTBRepository(db));
    return await runProjectFileQA({
      fileId: input.fileId,
      projectRepo,
      segmentRepo: db,
      resolveTermMatches: (projectId, segment) => terminology.findMatches(projectId, segment),
      transaction: (work) => db.runInTransaction(work, 'immediate'),
      getRevision: () => db.getQARevision(),
    });
  } finally {
    db.close();
  }
}

void run()
  .then(
    (result) => parentPort?.postMessage({ type: 'done', result }),
    (error: unknown) =>
      parentPort?.postMessage({
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      }),
  )
  .finally(() => parentPort?.close());
