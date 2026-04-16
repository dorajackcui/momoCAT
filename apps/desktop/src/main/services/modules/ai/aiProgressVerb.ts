import { normalizeProjectType, type ProjectType } from '@cat/core/project';

export function getAIProgressVerb(projectType?: ProjectType): string {
  const normalizedType = normalizeProjectType(projectType);

  if (normalizedType === 'review') {
    return 'Reviewing';
  }
  if (normalizedType === 'custom') {
    return 'Processing';
  }
  return 'Translating';
}
