import { describe, expect, it } from 'vitest';
import {
  resolveTagPolicy,
  resolveStoredFileTagPolicy,
  tagPolicyFingerprintValue,
} from './tagPolicy';

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

describe('resolveStoredFileTagPolicy', () => {
  it.each([
    undefined,
    null,
    '',
    '{}',
    '{"sourceCol":0}',
    '{"tagPolicy":null}',
    '{"tagPolicy":"default"}',
  ])('defaults legacy or omitted policy: %s', (importOptionsJson) => {
    expect(resolveStoredFileTagPolicy({ id: 12, importOptionsJson })).toBe('default');
  });
  it('preserves Plain mode', () => {
    expect(resolveStoredFileTagPolicy({ id: 12, importOptionsJson: '{"tagPolicy":"none"}' })).toBe(
      'none',
    );
  });
  it.each([
    ['{broken', 'invalid JSON.'],
    ['null', 'expected a JSON object.'],
    ['[]', 'expected a JSON object.'],
    ['"none"', 'expected a JSON object.'],
    ['true', 'expected a JSON object.'],
    ['{"tagPolicy":"html-only"}', 'tagPolicy must be default or none.'],
    ['{"tagPolicy":false}', 'tagPolicy must be default or none.'],
  ])('rejects invalid saved options with file context: %s', (importOptionsJson, reason) => {
    expect(() => resolveStoredFileTagPolicy({ id: 12, importOptionsJson })).toThrow(
      `Invalid import options for file 12: ${reason}`,
    );
  });
});
