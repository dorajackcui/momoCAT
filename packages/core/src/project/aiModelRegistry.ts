export const BUILTIN_OPENAI_PROVIDER_MODELS = {
  'builtin:openai:gpt-5.4': 'gpt-5.4',
  'builtin:openai:gpt-5.4-mini': 'gpt-5.4-mini',
  'builtin:openai:gpt-5': 'gpt-5',
  'builtin:openai:gpt-5-mini': 'gpt-5-mini',
} as const;

export const PROJECT_AI_MODELS = Object.keys(BUILTIN_OPENAI_PROVIDER_MODELS) as [
  'builtin:openai:gpt-5.4',
  'builtin:openai:gpt-5.4-mini',
  'builtin:openai:gpt-5',
  'builtin:openai:gpt-5-mini',
];
export type BuiltinOpenAIProviderId = (typeof PROJECT_AI_MODELS)[number];
export type ProjectAIModel = string;

export const DEFAULT_PROJECT_AI_MODEL: ProjectAIModel = 'builtin:openai:gpt-5.4-mini';
export const PROJECT_AI_MODEL_SET = new Set<string>(PROJECT_AI_MODELS);

const LEGACY_MODEL_TO_PROVIDER_ID: Record<string, BuiltinOpenAIProviderId> = {
  'gpt-5.4': 'builtin:openai:gpt-5.4',
  'gpt-5.4-mini': 'builtin:openai:gpt-5.4-mini',
  'gpt-5': 'builtin:openai:gpt-5',
  'gpt-5-mini': 'builtin:openai:gpt-5-mini',
};

export function isBuiltinProjectAIModel(value: string | null | undefined): value is BuiltinOpenAIProviderId {
  return typeof value === 'string' && PROJECT_AI_MODEL_SET.has(value);
}

export function isLegacyProjectAIModel(value: string | null | undefined): value is keyof typeof LEGACY_MODEL_TO_PROVIDER_ID {
  return typeof value === 'string' && value in LEGACY_MODEL_TO_PROVIDER_ID;
}

export function isProjectAIModel(value: string | null | undefined): value is ProjectAIModel {
  return typeof value === 'string' && value.trim().length > 0;
}

export function toBuiltinProviderId(value: string | null | undefined): BuiltinOpenAIProviderId | null {
  if (!value) {
    return null;
  }

  if (isBuiltinProjectAIModel(value)) {
    return value;
  }

  return LEGACY_MODEL_TO_PROVIDER_ID[value] ?? null;
}

export function getBuiltinOpenAIProviderModel(
  providerId: string | null | undefined,
): string | undefined {
  const builtinId = toBuiltinProviderId(providerId);
  return builtinId ? BUILTIN_OPENAI_PROVIDER_MODELS[builtinId] : undefined;
}

export function normalizeProjectAIModel(value: string | null | undefined): ProjectAIModel {
  if (!isProjectAIModel(value)) {
    return DEFAULT_PROJECT_AI_MODEL;
  }

  return toBuiltinProviderId(value) ?? value.trim();
}
