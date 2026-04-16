import {
  DEFAULT_PROJECT_AI_MODEL,
  buildAISystemPrompt,
  normalizeProjectAIModel as normalizeProjectAIModelCore,
  normalizeProjectType,
  type ProjectType,
} from '@cat/core/project';
import type { AIProviderSummary } from '../../../../../shared/ipc';
import type { AITestMetaInput, ProjectAIFlags, ProjectAIFlagsInput } from './types';

export { DEFAULT_PROJECT_AI_MODEL };

export const normalizeProjectAIModel = normalizeProjectAIModelCore;

export function normalizeProjectAIProviderSelection(
  value: string | null | undefined,
  providers: AIProviderSummary[],
): string {
  const normalized = normalizeProjectAIModelCore(value);
  return providers.some((provider) => provider.id === normalized)
    ? normalized
    : DEFAULT_PROJECT_AI_MODEL;
}

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
      input.testMeta || input.testUserPrompt || input.testSystemPrompt || input.testRawResponse,
    ),
  };
}

export function buildProjectAISystemPromptPreview(input: {
  projectType?: ProjectType;
  srcLang: string;
  tgtLang: string;
  promptDraft: string;
}): string {
  return buildAISystemPrompt(normalizeProjectType(input.projectType), {
    srcLang: input.srcLang,
    tgtLang: input.tgtLang,
    projectPrompt: input.promptDraft.trim(),
  });
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
