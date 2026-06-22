import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  CAT_TRANSLATION_AUDIT_ENV,
  CAT_TRANSLATION_AUDIT_FILE_ENV,
  createTranslationAuditDebugSink,
  isTranslationAuditDebugEnabled,
} from './translationAuditDebug';

describe('translationAuditDebug', () => {
  it('treats common truthy values as enabled', () => {
    for (const value of ['1', 'true', 'yes', 'on', ' TRUE ']) {
      expect(isTranslationAuditDebugEnabled({ [CAT_TRANSLATION_AUDIT_ENV]: value })).toBe(true);
    }
  });

  it('returns undefined when disabled', () => {
    expect(createTranslationAuditDebugSink('user-data', {})).toBeUndefined();
    expect(
      createTranslationAuditDebugSink('user-data', {
        [CAT_TRANSLATION_AUDIT_ENV]: 'false',
        [CAT_TRANSLATION_AUDIT_FILE_ENV]: 'audit.jsonl',
      }),
    ).toBeUndefined();
  });

  it('uses the default user data path when enabled without an explicit file path', () => {
    const userDataPath = join('tmp', 'cat-data');
    const audit = createTranslationAuditDebugSink(userDataPath, {
      [CAT_TRANSLATION_AUDIT_ENV]: '1',
    });

    expect(audit?.filePath).toBe(join(userDataPath, 'translation_audit_debug.jsonl'));
    expect(audit?.sink).toBeDefined();
  });

  it('uses the explicit file path as-is when provided', () => {
    const audit = createTranslationAuditDebugSink('user-data', {
      [CAT_TRANSLATION_AUDIT_ENV]: 'yes',
      [CAT_TRANSLATION_AUDIT_FILE_ENV]: 'D:/logs/audit.jsonl',
    });

    expect(audit?.filePath).toBe('D:/logs/audit.jsonl');
    expect(audit?.sink).toBeDefined();
  });
});
