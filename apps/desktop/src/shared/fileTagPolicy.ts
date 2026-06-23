import type { TagPolicy } from '@cat/core/tag';
import type { ImportOptions, ProjectFileRecord } from './ipc';

export const DEFAULT_FILE_TAG_POLICY: TagPolicy = 'default';

export function coerceImportTagPolicy(value: unknown): TagPolicy {
  return value === 'none' ? 'none' : DEFAULT_FILE_TAG_POLICY;
}

export function resolveImportOptionsTagPolicy(
  options?: Pick<ImportOptions, 'tagPolicy'> | null,
): TagPolicy {
  return coerceImportTagPolicy(options?.tagPolicy);
}

export function parseFileImportOptions(
  file?: Pick<ProjectFileRecord, 'importOptionsJson'> | null,
): ImportOptions | undefined {
  if (!file?.importOptionsJson) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(file.importOptionsJson);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length === 0
    ) {
      return undefined;
    }

    return parsed as ImportOptions;
  } catch {
    return undefined;
  }
}

export function resolveFileTagPolicy(
  file?: Pick<ProjectFileRecord, 'importOptionsJson'> | null,
): TagPolicy {
  return resolveImportOptionsTagPolicy(parseFileImportOptions(file));
}
