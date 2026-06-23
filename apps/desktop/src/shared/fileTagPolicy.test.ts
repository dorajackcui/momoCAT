import { describe, expect, it } from 'vitest';
import {
  coerceImportTagPolicy,
  parseFileImportOptions,
  resolveFileTagPolicy,
  resolveImportOptionsTagPolicy,
} from './fileTagPolicy';

describe('fileTagPolicy', () => {
  it('defaults missing and unknown tag policy values to default', () => {
    expect(coerceImportTagPolicy(undefined)).toBe('default');
    expect(coerceImportTagPolicy(null)).toBe('default');
    expect(coerceImportTagPolicy('default')).toBe('default');
    expect(coerceImportTagPolicy('html-only')).toBe('default');
    expect(resolveImportOptionsTagPolicy()).toBe('default');
    expect(resolveImportOptionsTagPolicy(null)).toBe('default');
    expect(resolveImportOptionsTagPolicy({ tagPolicy: 'default' })).toBe('default');
  });

  it('resolves none when explicitly requested', () => {
    expect(coerceImportTagPolicy('none')).toBe('none');
    expect(resolveImportOptionsTagPolicy({ tagPolicy: 'none' })).toBe('none');
  });

  it('safely parses import options JSON and ignores invalid values', () => {
    expect(parseFileImportOptions({ importOptionsJson: '{"hasHeader":true,"sourceCol":1}' })).toEqual({
      hasHeader: true,
      sourceCol: 1,
    });
    expect(parseFileImportOptions({ importOptionsJson: null })).toBeUndefined();
    expect(parseFileImportOptions({ importOptionsJson: '' })).toBeUndefined();
    expect(parseFileImportOptions({ importOptionsJson: 'null' })).toBeUndefined();
    expect(parseFileImportOptions({ importOptionsJson: '[]' })).toBeUndefined();
    expect(parseFileImportOptions({ importOptionsJson: '{bad json' })).toBeUndefined();
    expect(parseFileImportOptions()).toBeUndefined();
  });

  it('resolves file tag policy from import options JSON and defaults otherwise', () => {
    expect(resolveFileTagPolicy({ importOptionsJson: '{"tagPolicy":"none"}' })).toBe('none');
    expect(resolveFileTagPolicy({ importOptionsJson: '{"tagPolicy":"default"}' })).toBe('default');
    expect(resolveFileTagPolicy({ importOptionsJson: '{"tagPolicy":"html-only"}' })).toBe('default');
    expect(resolveFileTagPolicy({ importOptionsJson: '{bad json' })).toBe('default');
    expect(resolveFileTagPolicy()).toBe('default');
  });
});
