import { describe, expect, it } from 'vitest';
import { resolveTagPolicy, tagPolicyFingerprintValue } from './tagPolicy';

describe('resolveTagPolicy', () => {
  it('resolves omitted and default policy values to default', () => {
    expect(resolveTagPolicy(undefined)).toBe('default');
    expect(resolveTagPolicy(null)).toBe('default');
    expect(resolveTagPolicy('default')).toBe('default');
  });

  it('resolves none policy values to none', () => {
    expect(resolveTagPolicy('none')).toBe('none');
  });

  it('throws for invalid runtime values', () => {
    expect(() => resolveTagPolicy('html-only')).toThrow('tagPolicy must be default or none.');
  });
});

describe('tagPolicyFingerprintValue', () => {
  it('omits omitted and default policy values from fingerprints', () => {
    expect(tagPolicyFingerprintValue(undefined)).toBeUndefined();
    expect(tagPolicyFingerprintValue(null)).toBeUndefined();
    expect(tagPolicyFingerprintValue('default')).toBeUndefined();
  });

  it('includes none policy values in fingerprints', () => {
    expect(tagPolicyFingerprintValue('none')).toBe('none');
  });
});
