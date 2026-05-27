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

export function tagPolicyFingerprintValue(value: unknown): string | undefined {
  const resolved = resolveTagPolicy(value);
  return resolved === 'none' ? resolved : undefined;
}
