import { access } from 'fs/promises';
import { join } from 'path';
import { Worker } from 'worker_threads';
import type { Segment, TBMatch } from '@cat/core/models';
import type { TMConcordanceEntry, TMMatch } from '../../../shared/ipc';
import type {
  ReferenceLookupService,
  ReferenceLookupWorkerRequest,
  ReferenceLookupWorkerResponse,
} from './types';

interface WorkerLike {
  postMessage(message: ReferenceLookupWorkerRequest): void;
  on(event: 'message', listener: (message: ReferenceLookupWorkerResponse) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  terminate(): Promise<number> | number;
}

type WorkerFactory = (
  workerPath: string,
  options: { workerData: { dbPath: string } },
) => WorkerLike;

interface PendingRequest<T> {
  kind: ReferenceLookupWorkerRequest['kind'];
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

interface ReferenceLookupWorkerManagerOptions {
  dbPath: string;
  workerFactory?: WorkerFactory;
  workerPathCandidates?: string[];
}

const DISPOSED_ERROR_MESSAGE = 'Reference lookup worker disposed';

export class ReferenceLookupWorkerManager implements ReferenceLookupService {
  private worker: WorkerLike | null = null;
  private workerPath: string | null = null;
  private workerStartPromise: Promise<WorkerLike> | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest<unknown>>();
  private disposed = false;

  constructor(private readonly options: ReferenceLookupWorkerManagerOptions) {}

  public findTmMatches(projectId: number, segment: Segment): Promise<TMMatch[]> {
    return this.request<TMMatch[]>({ requestId: 0, kind: 'tm', projectId, segment });
  }

  public findTbMatches(projectId: number, segment: Segment): Promise<TBMatch[]> {
    return this.request<TBMatch[]>({ requestId: 0, kind: 'tb', projectId, segment });
  }

  public searchConcordance(projectId: number, query: string): Promise<TMConcordanceEntry[]> {
    return this.request<TMConcordanceEntry[]>({
      requestId: 0,
      kind: 'concordance',
      projectId,
      query,
    });
  }

  public async invalidateReferenceData(): Promise<void> {
    // Only a live worker holds caches worth dropping; a lazily-started one
    // will read fresh data anyway, so don't spin a worker up just for this.
    if (!this.worker && !this.workerStartPromise) return;
    await this.request<null>({ requestId: 0, kind: 'invalidate' });
  }

  public async warmUp(): Promise<void> {
    await this.ensureWorker();
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
    const worker = this.worker;
    this.worker = null;
    this.failAll(new Error(DISPOSED_ERROR_MESSAGE));

    if (!worker) return;
    await Promise.resolve(worker.terminate());
  }

  private request<T>(request: ReferenceLookupWorkerRequest & { requestId: 0 }): Promise<T> {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const message = { ...request, requestId } as ReferenceLookupWorkerRequest;

    return new Promise<T>((resolve, reject) => {
      if (this.disposed) {
        reject(new Error(DISPOSED_ERROR_MESSAGE));
        return;
      }

      this.pending.set(requestId, {
        kind: message.kind,
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      this.ensureWorker()
        .then((worker) => {
          if (!this.pending.has(requestId)) return;

          try {
            worker.postMessage(message);
          } catch (error) {
            this.rejectPendingRequest(requestId, this.toError(error));
          }
        })
        .catch((error) => {
          this.rejectPendingRequest(requestId, this.toError(error));
        });
    });
  }

  private async ensureWorker(): Promise<WorkerLike> {
    if (this.disposed) {
      throw new Error(DISPOSED_ERROR_MESSAGE);
    }

    if (this.worker) {
      return this.worker;
    }

    if (!this.workerStartPromise) {
      this.workerStartPromise = this.startWorker().finally(() => {
        this.workerStartPromise = null;
      });
    }

    return this.workerStartPromise;
  }

  private async startWorker(): Promise<WorkerLike> {
    const workerPath = await this.resolveWorkerPath();
    if (this.disposed) {
      throw new Error(DISPOSED_ERROR_MESSAGE);
    }

    const workerFactory = this.options.workerFactory ?? this.createWorker;
    const worker = workerFactory(workerPath, { workerData: { dbPath: this.options.dbPath } });

    worker.on('message', (message) => this.handleMessage(message));
    worker.on('error', (error) => this.handleWorkerError(worker, error));
    worker.on('exit', (code) => this.handleWorkerExit(worker, code));

    this.worker = worker;
    return worker;
  }

  private async resolveWorkerPath(): Promise<string> {
    if (this.workerPath) {
      return this.workerPath;
    }

    const candidatePaths = this.options.workerPathCandidates ?? [
      join(__dirname, 'referenceLookupWorker.js'),
      join(__dirname, '../referenceLookupWorker.js'),
      join(__dirname, '../../referenceLookupWorker.js'),
    ];

    for (const candidatePath of candidatePaths) {
      try {
        await access(candidatePath);
        this.workerPath = candidatePath;
        return candidatePath;
      } catch {
        // Try the next packaged worker location.
      }
    }

    throw new Error(`Reference lookup worker not found. Tried: ${candidatePaths.join(', ')}`);
  }

  private createWorker: WorkerFactory = (workerPath, options) => new Worker(workerPath, options);

  private handleMessage(message: ReferenceLookupWorkerResponse): void {
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    if (!message.ok) {
      pending.reject(new Error(message.error || 'Reference lookup worker failed'));
      return;
    }
    pending.resolve(message.result);
  }

  private handleWorkerError(worker: WorkerLike, error: Error): void {
    if (this.worker !== worker) return;
    this.worker = null;
    this.failAll(error);
  }

  private handleWorkerExit(worker: WorkerLike, code: number): void {
    if (this.worker !== worker) return;
    this.worker = null;

    if (code !== 0) {
      this.failAll(new Error(`Reference lookup worker exited with code ${code}`));
      return;
    }

    if (!this.disposed && this.pending.size > 0) {
      this.failAll(new Error('Reference lookup worker exited before completing requests'));
    }
  }

  private failAll(error: Error): void {
    for (const [requestId, pending] of this.pending) {
      this.pending.delete(requestId);
      pending.reject(error);
    }
  }

  private rejectPendingRequest(requestId: number, error: Error): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    pending.reject(error);
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }
}
