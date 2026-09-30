import type { LocalizationTargetBaseline } from './types';

export interface TargetBaselineOptions {
  targetBaseline?: LocalizationTargetBaseline;
}

export function resolveTargetBaseline(options?: TargetBaselineOptions): LocalizationTargetBaseline {
  return options?.targetBaseline ?? 'use-current-targets';
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
