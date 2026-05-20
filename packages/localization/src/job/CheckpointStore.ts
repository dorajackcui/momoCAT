import type { CheckpointRecord, JobUnit, UnitResult } from './types';
import {
  type JsonlReadDiagnostic,
  appendJsonlRecord,
  readJsonlRecordEntries,
} from './JsonlStore';

export interface CheckpointDiagnostic extends JsonlReadDiagnostic {
  reason?: string;
}

export interface CheckpointLoadResult {
  diagnostics: CheckpointDiagnostic[];
  records: CheckpointRecord[];
}

export class CheckpointIndex {
  readonly diagnostics: CheckpointDiagnostic[];

  private readonly byUnit = new Map<string, CheckpointRecord>();

  constructor(records: CheckpointRecord[], diagnostics: CheckpointDiagnostic[] = []) {
    this.diagnostics = diagnostics;

    for (const record of records) {
      this.byUnit.set(unitKey(record.doc, record.unit), record);
    }
  }

  getRecord(unit: Pick<JobUnit, 'documentId' | 'unitId'>): CheckpointRecord | undefined {
    return this.byUnit.get(unitKey(unit.documentId, unit.unitId));
  }

  getReusableRecord(unit: JobUnit): CheckpointRecord | undefined {
    const record = this.getRecord(unit);

    if (!record || record.hash !== unit.sourceHash) {
      return undefined;
    }

    if (record.status !== 'translated') {
      return undefined;
    }

    return record;
  }

  isPending(unit: JobUnit): boolean {
    return this.getReusableRecord(unit) === undefined;
  }

  toReusedResult(unit: JobUnit): UnitResult | undefined {
    const record = this.getReusableRecord(unit);

    if (!record) {
      return undefined;
    }

    return {
      jobId: record.job,
      documentId: record.doc,
      unitId: record.unit,
      sourceHash: record.hash,
      status: 'reused',
      source: unit.source,
      target: record.target,
      error: record.error,
      attempts: record.attempts,
      metadata: unit.metadata,
    };
  }
}

export class CheckpointStore {
  constructor(private readonly filePath: string) {}

  async append(record: CheckpointRecord): Promise<void> {
    await appendJsonlRecord(this.filePath, record);
  }

  async load(jobId: string): Promise<CheckpointIndex> {
    const result = await this.loadRecords(jobId);
    return new CheckpointIndex(result.records, result.diagnostics);
  }

  async loadRecords(jobId: string): Promise<CheckpointLoadResult> {
    const { entries, diagnostics } = await readJsonlRecordEntries<unknown>(this.filePath);
    const validRecords: CheckpointRecord[] = [];
    const checkpointDiagnostics: CheckpointDiagnostic[] = [...diagnostics];

    entries.forEach((entry) => {
      const parsed = parseCheckpointRecord(entry.record);

      if (!parsed) {
        checkpointDiagnostics.push({
          line: entry.line,
          raw: entry.raw,
          error: 'Invalid checkpoint record',
          reason: 'Record does not match CheckpointRecord shape',
        });
        return;
      }

      if (parsed.job === jobId) {
        validRecords.push(parsed);
      }
    });

    return { records: validRecords, diagnostics: checkpointDiagnostics };
  }
}

function parseCheckpointRecord(record: unknown): CheckpointRecord | undefined {
  if (!isObject(record)) {
    return undefined;
  }

  const status = record.status;

  if (status !== 'translated' && status !== 'skipped' && status !== 'failed') {
    return undefined;
  }

  if (
    typeof record.job !== 'string' ||
    typeof record.doc !== 'string' ||
    typeof record.unit !== 'string' ||
    typeof record.hash !== 'string' ||
    typeof record.attempts !== 'number' ||
    typeof record.at !== 'string'
  ) {
    return undefined;
  }

  if (record.target !== undefined && typeof record.target !== 'string') {
    return undefined;
  }

  if (record.error !== undefined && typeof record.error !== 'string') {
    return undefined;
  }

  return {
    job: record.job,
    doc: record.doc,
    unit: record.unit,
    hash: record.hash,
    status,
    target: record.target,
    error: record.error,
    attempts: record.attempts,
    at: record.at,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function unitKey(documentId: string, unitId: string): string {
  return `${documentId}\u0000${unitId}`;
}
