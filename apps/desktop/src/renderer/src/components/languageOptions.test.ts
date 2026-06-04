import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASSET_SOURCE_LANG,
  DEFAULT_ASSET_TARGET_LANG,
  DEFAULT_PROJECT_SOURCE_LANG,
  DEFAULT_PROJECT_TARGET_LANG,
  LANGUAGE_OPTIONS,
} from './languageOptions';

describe('languageOptions', () => {
  it('keeps project and asset creation on the same language option set', () => {
    const values = LANGUAGE_OPTIONS.map((language) => language.value);

    expect(DEFAULT_ASSET_SOURCE_LANG).toBe('zh-CN');
    expect(DEFAULT_ASSET_TARGET_LANG).toBe('en-US');
    expect(values).toContain(DEFAULT_PROJECT_SOURCE_LANG);
    expect(values).toContain(DEFAULT_PROJECT_TARGET_LANG);
    expect(values).toContain(DEFAULT_ASSET_SOURCE_LANG);
    expect(values).toContain(DEFAULT_ASSET_TARGET_LANG);
    expect(new Set(values).size).toBe(values.length);
  });
});
