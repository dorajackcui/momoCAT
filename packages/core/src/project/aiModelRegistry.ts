export type ProjectAIModel = string;

export const DEFAULT_PROJECT_AI_MODEL: ProjectAIModel = "";

export function isProjectAIModel(
  value: string | null | undefined,
): value is ProjectAIModel {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeProjectAIModel(
  value: string | null | undefined,
): ProjectAIModel {
  return isProjectAIModel(value) ? value.trim() : DEFAULT_PROJECT_AI_MODEL;
}
