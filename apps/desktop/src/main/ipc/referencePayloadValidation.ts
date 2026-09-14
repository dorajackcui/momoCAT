import type {
  TBImportOptions,
  TBSyncColumns,
  TBSyncConfigInput,
  TMCommitOptions,
  TMImportOptions,
  TMSyncColumns,
  TMSyncConfigInput,
  TMType,
} from '../../shared/ipc';
import {
  isBoolean,
  isNonEmptyString,
  isNonNegativeInteger,
  isOptional,
  isRecord,
} from './argumentValidation';

export function isTMType(value: unknown): value is TMType {
  return value === 'working' || value === 'main';
}

export function isTMCommitOptions(value: unknown): value is TMCommitOptions {
  return (
    isRecord(value) &&
    (value.scope === undefined || value.scope === 'confirmed-only' || value.scope === 'all')
  );
}

function isTMSyncColumns(value: unknown): value is TMSyncColumns {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.sourceCol) &&
    isNonNegativeInteger(value.targetCol) &&
    isBoolean(value.hasHeader)
  );
}

function isTBSyncColumns(value: unknown): value is TBSyncColumns {
  return (
    isRecord(value) && isTMSyncColumns(value) && isOptional(value.noteCol, isNonNegativeInteger)
  );
}

export function isTMImportOptions(value: unknown): value is TMImportOptions {
  return isRecord(value) && isTMSyncColumns(value) && isBoolean(value.overwrite);
}

export function isTBImportOptions(value: unknown): value is TBImportOptions {
  return isRecord(value) && isTBSyncColumns(value) && isBoolean(value.overwrite);
}

export function isTMSyncConfigInput(value: unknown): value is TMSyncConfigInput {
  return isRecord(value) && isNonEmptyString(value.filePath) && isTMSyncColumns(value.columns);
}

export function isTBSyncConfigInput(value: unknown): value is TBSyncConfigInput {
  return isRecord(value) && isNonEmptyString(value.filePath) && isTBSyncColumns(value.columns);
}
