import type { TMSyncReport } from '../../../../shared/ipc';

export interface ImportProgress {
  current: number;
  total: number;
  message?: string;
}

export type ImportProgressCallback = (progress: ImportProgress) => void;

export interface TMImportWorkerProgressMessage {
  type: 'progress';
  current: number;
  total: number;
  message?: string;
}

export interface TMImportWorkerDoneMessage {
  type: 'done';
  result?: { success: number; skipped: number };
}

export interface TMImportWorkerErrorMessage {
  type: 'error';
  error?: string;
}

export type TMImportWorkerMessage =
  | TMImportWorkerProgressMessage
  | TMImportWorkerDoneMessage
  | TMImportWorkerErrorMessage;

export interface TMSyncWorkerProgressMessage {
  type: 'progress';
  percent: number;
  message?: string;
}

export interface TMSyncWorkerDoneMessage {
  type: 'done';
  result: TMSyncReport;
}

export interface TMSyncWorkerErrorMessage {
  type: 'error';
  error?: string;
}

export type TMSyncWorkerMessage =
  | TMSyncWorkerProgressMessage
  | TMSyncWorkerDoneMessage
  | TMSyncWorkerErrorMessage;
