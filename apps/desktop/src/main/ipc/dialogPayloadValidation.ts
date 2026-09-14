import type { DialogFileFilter } from '../../shared/ipc';
import { isArrayOf, isRecord, isString } from './argumentValidation';

function isDialogFileFilter(value: unknown): value is DialogFileFilter {
  return isRecord(value) && isString(value.name) && isArrayOf(value.extensions, isString);
}

export function isDialogFileFilters(value: unknown): value is DialogFileFilter[] {
  return isArrayOf(value, isDialogFileFilter);
}
