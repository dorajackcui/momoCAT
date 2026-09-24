import type { TagPolicy } from '@cat/core/tag';

export function resolveTagPolicy(value: unknown): TagPolicy {
  if (value === undefined || value === null || value === 'default') {
    return 'default';
  }

  if (value === 'none') {
    return 'none';
  }

  throw new Error('tagPolicy must be default or none.');
}

/** Read persisted import options without silently changing a file's tag handling. */
export function resolveStoredFileTagPolicy(file: {
  id: number;
  importOptionsJson?: string | null;
}): TagPolicy {
  if (!file.importOptionsJson) return 'default';
  const invalid = (reason: string) =>
    new Error(`Invalid import options for file ${file.id}: ${reason}`);
  let options: unknown;
  try {
    options = JSON.parse(file.importOptionsJson);
  } catch {
    throw invalid('invalid JSON.');
  }
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw invalid('expected a JSON object.');
  try {
    return resolveTagPolicy((options as { tagPolicy?: unknown }).tagPolicy);
  } catch {
    throw invalid('tagPolicy must be default or none.');
  }
}

export function tagPolicyFingerprintValue(value: unknown): string | undefined {
  const resolved = resolveTagPolicy(value);
  return resolved === 'none' ? resolved : undefined;
}
