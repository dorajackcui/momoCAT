import type { LocalizationTargetBaseline, LocalizationTargetScope } from './types';

export interface TargetBaselineOptions {
  targetBaseline?: LocalizationTargetBaseline;
  targetScope?: LocalizationTargetScope;
}

export function resolveTargetBaseline(
  options?: TargetBaselineOptions,
): LocalizationTargetBaseline {
  if (options?.targetBaseline) {
    return options.targetBaseline;
  }

  return options?.targetScope === 'overwrite-non-confirmed'
    ? 'ignore-current-targets'
    : 'use-current-targets';
}

export function normalizeTargetForBaseline(input: {
  target?: string;
  locked?: boolean;
  targetBaseline: LocalizationTargetBaseline;
}): string {
  if (input.locked || input.targetBaseline === 'use-current-targets') {
    return input.target ?? '';
  }

  return '';
}
