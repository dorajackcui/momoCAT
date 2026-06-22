import { createHash } from 'crypto';
import { appendFile, mkdir } from 'fs/promises';
import { dirname } from 'path';

export interface TranslationAuditUnitRef {
  doc: string;
  unit: string;
  rid?: string;
  row?: number;
}

export interface TranslationAuditMtBatchRequestEvent {
  event: 'mt_batch_request';
  job: string;
  task: string;
  mode: 'window' | 'window-partial';
  units: TranslationAuditUnitRef[];
}

export interface TranslationAuditMtBatchResponseEvent {
  event: 'mt_batch_response';
  job: string;
  task: string;
  latencyMs: number;
  returnedIds: string[];
}

export interface TranslationAuditMtBatchErrorEvent {
  event: 'mt_batch_error';
  job: string;
  task: string;
  latencyMs: number;
  message: string;
}

export interface TranslationAuditMtTagInvalidEvent {
  event: 'mt_tag_invalid';
  job: string;
  task: string;
  unit: string;
  rid: string;
  messages: string[];
  targetHash: string;
  targetChars: number;
}

export interface TranslationAuditMtRepairRequestEvent {
  event: 'mt_repair_request';
  job: string;
  task: string;
  unit: string;
  rid: string;
  reason: 'tag_invalid';
}

export interface TranslationAuditMtRepairSuccessEvent {
  event: 'mt_repair_success';
  job: string;
  task: string;
  unit: string;
  rid: string;
  targetHash: string;
  targetChars: number;
}

export interface TranslationAuditMtRepairFailedEvent {
  event: 'mt_repair_failed';
  job: string;
  task: string;
  unit: string;
  rid: string;
  message: string;
}

export interface TranslationAuditUnitPersistedEvent {
  event: 'unit_persisted';
  job: string;
  task: string;
  doc: string;
  unit: string;
  status: 'translated' | 'skipped' | 'reused' | 'failed';
  attempts: number;
  targetHash?: string;
  targetChars?: number;
}

export interface TranslationAuditRuntimeTmCommitEvent {
  event: 'runtime_tm_commit';
  job: string;
  task: string;
  units: TranslationAuditUnitRef[];
}

export type TranslationAuditEvent =
  | TranslationAuditMtBatchRequestEvent
  | TranslationAuditMtBatchResponseEvent
  | TranslationAuditMtBatchErrorEvent
  | TranslationAuditMtTagInvalidEvent
  | TranslationAuditMtRepairRequestEvent
  | TranslationAuditMtRepairSuccessEvent
  | TranslationAuditMtRepairFailedEvent
  | TranslationAuditUnitPersistedEvent
  | TranslationAuditRuntimeTmCommitEvent;

export interface TranslationAuditSink {
  record(event: TranslationAuditEvent): void;
  flush?(): Promise<void>;
}

export interface TranslationAuditContext {
  jobId: string;
  sink: TranslationAuditSink;
}

export const noopTranslationAuditSink: TranslationAuditSink = {
  record() {
    // Intentionally empty.
  },
};

export interface MemoryTranslationAuditSink extends TranslationAuditSink {
  events: TranslationAuditEvent[];
}

export function createMemoryTranslationAuditSink(): MemoryTranslationAuditSink {
  const events: TranslationAuditEvent[] = [];
  return {
    events,
    record(event) {
      events.push(event);
    },
  };
}

interface JsonlTranslationAuditSinkOptions {
  now?: () => Date;
  onError?: (error: unknown) => void;
}

export class JsonlTranslationAuditSink implements TranslationAuditSink {
  private queue: Promise<void> = Promise.resolve();
  private disabled = false;
  private readonly now: () => Date;
  private readonly onError: (error: unknown) => void;

  constructor(
    private readonly filePath: string,
    options: JsonlTranslationAuditSinkOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.onError = options.onError ?? ((error) => console.error(error));
  }

  record(event: TranslationAuditEvent): void {
    if (this.disabled) {
      return;
    }

    const line = `${JSON.stringify({ at: this.now().toISOString(), ...event })}\n`;
    this.queue = this.queue
      .then(async () => {
        await mkdir(dirname(this.filePath), { recursive: true });
        await appendFile(this.filePath, line, 'utf8');
      })
      .catch((error) => {
        this.disabled = true;
        this.onError(error);
      });
  }

  async flush(): Promise<void> {
    await this.queue;
  }
}

export function summarizeAuditText(
  value: string | undefined,
): { targetHash: string; targetChars: number } | undefined {
  if (value === undefined) {
    return undefined;
  }

  return {
    targetHash: createHash('sha256').update(value).digest('hex').slice(0, 12),
    targetChars: value.length,
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
