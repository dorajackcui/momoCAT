import { resolveTargetBaseline } from '../targetBaseline';
import type { LocalizationEngineOptions, LocalizationMode, TranslateUnitsOptions } from '../types';

export function resolveLocalizationMode(
  mode: LocalizationMode | undefined,
  defaults: LocalizationEngineOptions,
): LocalizationMode {
  return mode ?? defaults.defaultMode ?? 'standard';
}

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

export function resolveWindowTargetBaseline(
  options: TranslateUnitsOptions | undefined,
  defaults: LocalizationEngineOptions,
) {
  return resolveTargetBaseline({
    targetBaseline: options?.targetBaseline,
    targetScope: options?.targetScope ?? defaults.defaultTargetScope,
  });
}

export function normalizeWindowJobOptions(
  options: TranslateUnitsOptions | undefined,
  defaults: LocalizationEngineOptions,
): TranslateUnitsOptions {
  const restOptions = { ...options };
  delete restOptions.targetScope;

  return {
    ...restOptions,
    targetBaseline: resolveWindowTargetBaseline(options, defaults),
  };
}
