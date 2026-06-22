import { join } from 'path';
import { JsonlTranslationAuditSink, type TranslationAuditSink } from '@cat/localization';

export const CAT_TRANSLATION_AUDIT_ENV = 'CAT_TRANSLATION_AUDIT';
export const CAT_TRANSLATION_AUDIT_FILE_ENV = 'CAT_TRANSLATION_AUDIT_FILE';

export interface TranslationAuditDebugSink {
  filePath: string;
  sink: TranslationAuditSink;
}

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function isTranslationAuditDebugEnabled(
  env: Pick<NodeJS.ProcessEnv, string> = process.env,
): boolean {
  return isTruthyFlag(env[CAT_TRANSLATION_AUDIT_ENV]);
}

export function createTranslationAuditDebugSink(
  userDataPath: string,
  env: Pick<NodeJS.ProcessEnv, string> = process.env,
): TranslationAuditDebugSink | undefined {
  if (!isTranslationAuditDebugEnabled(env)) {
    return undefined;
  }

  const explicitPath = env[CAT_TRANSLATION_AUDIT_FILE_ENV];
  const filePath = explicitPath || join(userDataPath, 'translation_audit_debug.jsonl');
  return {
    filePath,
    sink: new JsonlTranslationAuditSink(filePath),
  };
}
