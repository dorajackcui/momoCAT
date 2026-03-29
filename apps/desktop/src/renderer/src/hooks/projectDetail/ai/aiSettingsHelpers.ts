import {
  DEFAULT_PROJECT_AI_MODEL,
  normalizeProjectAIModel as normalizeProjectAIModelCore,
} from '@cat/core/project';
import type { AITestMetaInput, ProjectAIFlags, ProjectAIFlagsInput } from './types';

export { DEFAULT_PROJECT_AI_MODEL };

export const normalizeProjectAIModel = normalizeProjectAIModelCore;

export function deriveProjectAIFlags(input: ProjectAIFlagsInput): ProjectAIFlags {
  const normalizedPromptDraft = input.promptDraft.trim();
  const normalizedSavedPrompt = input.savedPromptValue.trim();
  const hasUnsavedModelChanges = input.modelDraft !== input.savedModelValue;

  return {
    normalizedPromptDraft,
    normalizedSavedPrompt,
    hasUnsavedPromptChanges:
      normalizedPromptDraft !== normalizedSavedPrompt || hasUnsavedModelChanges,
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
