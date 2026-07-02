import { parentPort, workerData } from 'worker_threads';
import { CATDatabase } from '@cat/db';
import { TMService } from './services/TMService';
import { TBService } from './services/TBService';
import { SqliteProjectRepository } from './services/adapters/SqliteProjectRepository';
import { SqliteTMRepository } from './services/adapters/SqliteTMRepository';
import { SqliteTBRepository } from './services/adapters/SqliteTBRepository';
import { TMQueryService } from './services/modules/tm/TMQueryService';
import type {
  ReferenceLookupWorkerRequest,
  ReferenceLookupWorkerResponse,
} from './services/referenceLookup/types';

interface ReferenceLookupWorkerInput {
  dbPath: string;
}

const port = parentPort;
if (!port) {
  throw new Error('Reference lookup worker requires parentPort');
}

const input = workerData as ReferenceLookupWorkerInput;
const db = new CATDatabase(input.dbPath, { readonly: true, fileMustExist: true });
const projectRepo = new SqliteProjectRepository(db);
const tmRepo = new SqliteTMRepository(db);
const tbRepo = new SqliteTBRepository(db);
const tmService = new TMService(projectRepo, tmRepo);
const tbService = new TBService(projectRepo, tbRepo);
const tmQueryService = new TMQueryService(tmRepo, tmService);

async function handleRequest(
  message: ReferenceLookupWorkerRequest,
): Promise<ReferenceLookupWorkerResponse> {
  if (message.kind === 'tm') {
    return {
      requestId: message.requestId,
      kind: 'tm',
      ok: true,
      result: await tmService.findMatches(message.projectId, message.segment),
    };
  }

  if (message.kind === 'tb') {
    return {
      requestId: message.requestId,
      kind: 'tb',
      ok: true,
      result: await tbService.findMatches(message.projectId, message.segment),
    };
  }

  return {
    requestId: message.requestId,
    kind: 'concordance',
    ok: true,
    result: await tmQueryService.searchConcordance(message.projectId, message.query),
  };
}

port.on('message', (message: ReferenceLookupWorkerRequest) => {
  void handleRequest(message)
    .then((response) => port.postMessage(response))
    .catch((error) => {
      port.postMessage({
        requestId: message.requestId,
        kind: message.kind,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies ReferenceLookupWorkerResponse);
    });
});
