import { resolveTargetBaseline } from '../targetBaseline';
import type { LocalizationEngineOptions, TranslateUnitsOptions } from '../types';

export function mergeMTOptions(
  defaults?: LocalizationEngineOptions['mt'],
  overrides?: LocalizationEngineOptions['mt'],
): NonNullable<LocalizationEngineOptions['mt']> {
  return {
    providerId: overrides?.providerId ?? defaults?.providerId,
    model: overrides?.model ?? defaults?.model,
    reasoningEffort: overrides?.reasoningEffort ?? defaults?.reasoningEffort,
    systemPrompt: overrides?.systemPrompt ?? defaults?.systemPrompt,
    temperature: overrides?.temperature ?? defaults?.temperature,
  };
}

export function normalizeWindowJobOptions(
  options: TranslateUnitsOptions | undefined,
): TranslateUnitsOptions {
  return { ...options, targetBaseline: resolveTargetBaseline(options) };
}
