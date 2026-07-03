export type SourceRecallProfile = 'cjk' | 'en';

const CJK_SOURCE_LOCALE_RE = /^(zh|ja|ko|cmn|yue)(?:-|$)/i;

export function resolveSourceRecallProfile(locale?: string): SourceRecallProfile {
  return CJK_SOURCE_LOCALE_RE.test(locale ?? '') ? 'cjk' : 'en';
}

export function isCjkSourceRecallProfile(locale?: string): boolean {
  return resolveSourceRecallProfile(locale) === 'cjk';
}
