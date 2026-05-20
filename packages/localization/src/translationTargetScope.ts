import type { LocalizationTargetScope } from './types';

export function resolveBatchTargetScope(scope?: LocalizationTargetScope): LocalizationTargetScope {
  if (scope === 'overwrite-non-confirmed') {
    return 'overwrite-non-confirmed';
  }

  return 'blank-only';
}
