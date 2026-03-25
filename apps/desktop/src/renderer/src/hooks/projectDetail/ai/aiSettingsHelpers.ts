import {
  DEFAULT_PROJECT_AI_MODEL,
  normalizeProjectAIModel as normalizeProjectAIModelCore,
} from '@cat/core/project';
import type { AITestMetaInput, ProjectAIFlags, ProjectAIFlagsInput } from './types';

export { DEFAULT_PROJECT_AI_MODEL };

export const DEFAULT_AI_TEMPERATURE = 0.2;

export function normalizeTemperatureValue(value: number): number {
  return Math.max(0, Math.min(2, Number(value.toFixed(2))));
}

export function formatTemperature(value: number): string {
  return normalizeTemperatureValue(value).toString();
}

export function parseTemperatureInput(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return normalizeTemperatureValue(parsed);
}

export const normalizeProjectAIModel = normalizeProjectAIModelCore;

export function deriveProjectAIFlags(input: ProjectAIFlagsInput): ProjectAIFlags {
  const normalizedPromptDraft = input.promptDraft.trim();
  const normalizedSavedPrompt = input.savedPromptValue.trim();
  const normalizedTemperatureDraft = parseTemperatureInput(input.temperatureDraft);
  const normalizedSavedTemperature = parseTemperatureInput(input.savedTemperatureValue);
  const hasUnsavedTemperatureChanges = normalizedTemperatureDraft !== normalizedSavedTemperature;
  const hasUnsavedModelChanges = input.modelDraft !== input.savedModelValue;

  return {
    normalizedPromptDraft,
    normalizedSavedPrompt,
    normalizedTemperatureDraft,
    normalizedSavedTemperature,
    hasUnsavedPromptChanges:
      normalizedPromptDraft !== normalizedSavedPrompt ||
      hasUnsavedTemperatureChanges ||
      hasUnsavedModelChanges,
    hasInvalidTemperature: normalizedTemperatureDraft === null,
    hasTestDetails: Boolean(
      input.testMeta || input.testUserMessage || input.testPromptUsed || input.testRawResponse,
    ),
  };
}

export function buildAITestMeta(input: AITestMetaInput): string {
  const metaParts: string[] = [];
  if (typeof input.status === 'number') metaParts.push(`status: ${input.status}`);
  if (input.requestId) metaParts.push(`requestId: ${input.requestId}`);
  if (input.model) metaParts.push(`model: ${input.model}`);
  if (input.endpoint) metaParts.push(`endpoint: ${input.endpoint}`);
  metaParts.push(`ok: ${input.ok ? 'true' : 'false'}`);
  return metaParts.join(' • ');
}
