export const PROJECT_AI_MODELS = ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5', 'gpt-5-mini'] as const;
export type ProjectAIModel = (typeof PROJECT_AI_MODELS)[number];

export const DEFAULT_PROJECT_AI_MODEL: ProjectAIModel = 'gpt-5.4-mini';
export const PROJECT_AI_MODEL_SET = new Set<string>(PROJECT_AI_MODELS);

export function isProjectAIModel(value: string | null | undefined): value is ProjectAIModel {
  return typeof value === 'string' && PROJECT_AI_MODEL_SET.has(value);
}

export function normalizeProjectAIModel(value: string | null | undefined): ProjectAIModel {
  return isProjectAIModel(value) ? value : DEFAULT_PROJECT_AI_MODEL;
}
