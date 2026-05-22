import {
  DEFAULT_PROJECT_AI_MODEL,
  buildAISystemPrompt,
  normalizeProjectAIModel as normalizeProjectAIModelCore,
  normalizeProjectType,
  type ProjectAIModel,
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
  if (!normalized) {
    return providers[0]?.id ?? '';
  }
  return normalized;
}

export function deriveProjectAIProviderAvailability(
  modelDraft: string,
  providerOptions: AIProviderSummary[],
): {
  providerUnavailable: boolean;
  providerSetupRequired: boolean;
  providerWarning: string | null;
} {
  const providerSetupRequired = providerOptions.length === 0;
  const providerUnavailable =
    !providerSetupRequired &&
    Boolean(modelDraft) &&
    !providerOptions.some((provider) => provider.id === modelDraft);
  const providerWarning = providerSetupRequired
    ? 'Add an AI provider in Settings before running AI actions.'
    : providerUnavailable
      ? 'The saved AI provider is no longer available. Choose a configured provider and save.'
      : null;

  return {
    providerUnavailable,
    providerSetupRequired,
    providerWarning,
  };
}

export function deriveProjectAIProviderDraftsAfterProviderOptionsChange(input: {
  projectAIModel: ProjectAIModel | null | undefined;
  modelDraft: ProjectAIModel;
  savedModelValue: ProjectAIModel;
  providerOptions: AIProviderSummary[];
}): {
  modelDraft: ProjectAIModel;
  savedModelValue: ProjectAIModel;
} {
  const projectModelValue = normalizeProjectAIModelCore(input.projectAIModel);
  const firstProviderId = input.providerOptions[0]?.id ?? '';
  const shouldAdoptFirstProvider =
    !projectModelValue && !input.modelDraft && !input.savedModelValue && Boolean(firstProviderId);

  if (!shouldAdoptFirstProvider) {
    return {
      modelDraft: input.modelDraft,
      savedModelValue: input.savedModelValue,
    };
  }

  return {
    modelDraft: firstProviderId,
    savedModelValue: firstProviderId,
  };
}

export function getProjectAIProviderActionBlockMessage(input: {
  providerSetupRequired: boolean;
  providerUnavailable: boolean;
  providerWarning: string | null;
}): string | null {
  if (!input.providerSetupRequired && !input.providerUnavailable) {
    return null;
  }
  return input.providerWarning ?? 'Choose a configured AI provider before running AI actions.';
}

export function normalizeProjectAIProviderPersistenceValue(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeProjectAIModelCore(value);
  return normalized || null;
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
