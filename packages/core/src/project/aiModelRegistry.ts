export const PROJECT_AI_MODELS = ['gpt-5.2', 'gpt-5-mini', 'gpt-4o', 'gpt-4.1-mini'] as const;
export type ProjectAIModel = (typeof PROJECT_AI_MODELS)[number];

export const DEFAULT_PROJECT_AI_MODEL: ProjectAIModel = 'gpt-4o';
export const PROJECT_AI_MODEL_SET = new Set<string>(PROJECT_AI_MODELS);

export function isProjectAIModel(value: string | null | undefined): value is ProjectAIModel {
  return typeof value === 'string' && PROJECT_AI_MODEL_SET.has(value);
}

export function normalizeProjectAIModel(value: string | null | undefined): ProjectAIModel {
  return isProjectAIModel(value) ? value : DEFAULT_PROJECT_AI_MODEL;
}
