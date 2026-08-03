import { access } from 'fs/promises';
import { Worker } from 'worker_threads';

interface ProgressInput {
  onProgress?: (current: number, total: number) => void;
  cancellationToken?: OperationCancellationToken;
}

interface OperationCancellationToken {
  isCancellationRequested(): boolean;
  onCancellationRequested(listener: () => void): () => void;
}

export type FileOperationWorkerMessage<TResult> =
  | { type: 'progress'; current: number; total: number }
  | { type: 'done'; result: TResult }
  | { type: 'error'; error: string };

interface WorkerLike<TMessage> {
  on(event: 'message', listener: (message: TMessage) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  postMessage(message: unknown): unknown;
}

export type FileOperationWorkerFactory<TWorkerInput, TMessage> = (
  workerPath: string,
  options: { workerData: TWorkerInput },
) => WorkerLike<TMessage>;

interface WorkerBackedFileOperationRunnerOptions<
  TInput extends ProgressInput,
  TWorkerInput,
  TResult,
> {
  dbPath: string;
  operationLabel: string;
  workerDescription: string;
  workerPathCandidates: string[];
  buildWorkerInput: (
    dbPath: string,
    input: Omit<TInput, 'onProgress' | 'cancellationToken'>,
  ) => TWorkerInput;
  workerFactory?: FileOperationWorkerFactory<TWorkerInput, FileOperationWorkerMessage<TResult>>;
  fallbackRunner?: (input: TInput) => Promise<TResult>;
  cancellationMessage?: unknown;
}

export class WorkerBackedFileOperationRunner<TInput extends ProgressInput, TWorkerInput, TResult> {
  private workerPath: string | null = null;

  constructor(
    private readonly options: WorkerBackedFileOperationRunnerOptions<TInput, TWorkerInput, TResult>,
  ) {}

  public async run(input: TInput): Promise<TResult> {
    const workerPath = await this.resolveWorkerPath();
    if (!workerPath) {
      // Fall back only when no worker script can be started. Once a worker has
      // started, its errors are real operation failures and must not re-run the
      // same work on the main thread.
      if (this.options.fallbackRunner) {
        console.error(
          `[${this.options.operationLabel}] Worker not found, falling back to main thread. Tried: ${this.options.workerPathCandidates.join(', ')}`,
        );
        return this.options.fallbackRunner(input);
      }
      throw new Error(
        `${this.options.workerDescription} not found. Tried: ${this.options.workerPathCandidates.join(', ')}`,
      );
    }

    const { onProgress, cancellationToken, ...jobInput } = input;
    const workerFactory = this.options.workerFactory ?? this.createWorker;

    return new Promise<TResult>((resolve, reject) => {
      const worker = workerFactory(workerPath, {
        workerData: this.options.buildWorkerInput(
          this.options.dbPath,
          jobInput as Omit<TInput, 'onProgress' | 'cancellationToken'>,
        ),
      });
      let settled = false;
      let unsubscribeCancellation: (() => void) | undefined;

      const settle = (complete: () => void) => {
        if (settled) return;
        settled = true;
        unsubscribeCancellation?.();
        complete();
      };
      const fail = (error: unknown) =>
        settle(() => reject(error instanceof Error ? error : new Error(String(error))));

      if (this.options.cancellationMessage !== undefined && cancellationToken) {
        const requestCancellation = () => {
          worker.postMessage(this.options.cancellationMessage);
        };
        if (cancellationToken.isCancellationRequested()) {
          requestCancellation();
        } else {
          unsubscribeCancellation = cancellationToken.onCancellationRequested(requestCancellation);
        }
      }

      worker.on('message', (message) => {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'progress') {
          onProgress?.(Number(message.current) || 0, Number(message.total) || 0);
          return;
        }
        if (message.type === 'done') {
          settle(() => resolve(message.result));
          return;
        }
        if (message.type === 'error') {
          fail(new Error(message.error || `${this.options.workerDescription} failed`));
        }
      });

      worker.on('error', fail);
      worker.on('exit', (code) => {
        if (settled) return;
        if (code === 0) {
          fail(new Error(`${this.options.workerDescription} exited without returning result`));
          return;
        }
        fail(new Error(`${this.options.workerDescription} exited with code ${code}`));
      });
    });
  }

  private async resolveWorkerPath(): Promise<string | null> {
    if (this.workerPath) return this.workerPath;
    for (const candidatePath of this.options.workerPathCandidates) {
      try {
        await access(candidatePath);
        this.workerPath = candidatePath;
        return candidatePath;
      } catch {
        // Try the next packaged worker location.
      }
    }
    return null;
  }

  private createWorker: FileOperationWorkerFactory<
    TWorkerInput,
    FileOperationWorkerMessage<TResult>
  > = (workerPath, options) => new Worker(workerPath, options);
}
