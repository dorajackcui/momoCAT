import type {
  AddAIProviderInput,
  AITranslateFileOptions,
  ProxySettingsInput,
  SourceTerminologyPromptSettingsInput,
  TestAIConnectionInput,
} from '../../shared/ipc';
import { parseAITranslationSegmentIds } from '../../shared/aiTranslationScope';
import { isOptional, isRecord, isString, readArgument } from './argumentValidation';

export function isTestAIConnectionInput(value: unknown): value is TestAIConnectionInput {
  return (
    isRecord(value) &&
    isOptional(value.connectionId, isString) &&
    isString(value.name) &&
    isString(value.baseUrl) &&
    isString(value.apiKey)
  );
}

export function isAddAIProviderInput(value: unknown): value is AddAIProviderInput {
  return (
    isRecord(value) && isString(value.name) && isString(value.connectionId) && isString(value.model)
  );
}

export function isProxySettingsInput(value: unknown): value is ProxySettingsInput {
  return (
    isRecord(value) &&
    (value.mode === 'off' || value.mode === 'system' || value.mode === 'custom') &&
    isOptional(value.customProxyUrl, isString)
  );
}

export function isSourceTerminologyPromptInput(
  value: unknown,
): value is SourceTerminologyPromptSettingsInput {
  if (!isRecord(value)) return false;
  switch (value.action) {
    case 'create':
      return isString(value.name) && isString(value.prompt);
    case 'update':
      return isString(value.promptId) && isString(value.name) && isString(value.prompt);
    case 'delete':
    case 'activate':
      return isString(value.promptId);
    default:
      return false;
  }
}

type AITranslationOptionsShape = Omit<AITranslateFileOptions, 'segmentIds'> & {
  segmentIds?: unknown;
};

function isAITranslationOptionsShape(value: unknown): value is AITranslationOptionsShape {
  return (
    isRecord(value) &&
    value.mode === undefined &&
    value.targetScope === undefined &&
    (value.targetBaseline === undefined ||
      value.targetBaseline === 'use-current-targets' ||
      value.targetBaseline === 'ignore-current-targets')
  );
}

export function readAITranslateFileOptions(value: unknown): AITranslateFileOptions | undefined {
  if (value === undefined) return undefined;
  const options = readArgument(value, 'AI translation options', isAITranslationOptionsShape);
  return { ...options, segmentIds: parseAITranslationSegmentIds(options.segmentIds) };
}
