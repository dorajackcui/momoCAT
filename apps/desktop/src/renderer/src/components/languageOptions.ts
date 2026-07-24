export const LANGUAGE_OPTIONS = [
  { label: 'Chinese (zh-CN)', value: 'zh-CN' },
  { label: 'English (en-US)', value: 'en-US' },
  { label: 'Japanese (ja-JP)', value: 'ja-JP' },
  { label: 'Korean (ko-KR)', value: 'ko-KR' },
  { label: 'German (de-DE)', value: 'de-DE' },
  { label: 'French (fr-FR)', value: 'fr-FR' },
  { label: 'Spanish (es-ES)', value: 'es-ES' },
  { label: 'Italian (it-IT)', value: 'it-IT' },
  { label: 'Portuguese (pt-PT)', value: 'pt-PT' },
  { label: 'Thai (th-TH)', value: 'th-TH' },
  { label: 'Bahasa Indonesia (id-ID)', value: 'id-ID' },
] as const;

export const DEFAULT_PROJECT_SOURCE_LANG = 'zh-CN';
export const DEFAULT_PROJECT_TARGET_LANG = 'en-US';
export const DEFAULT_ASSET_SOURCE_LANG = 'zh-CN';
export const DEFAULT_ASSET_TARGET_LANG = 'en-US';

interface LanguagePair {
  srcLang: string;
  tgtLang: string;
}

export function hasMatchingLanguagePair(resource: LanguagePair, project: LanguagePair): boolean {
  return resource.srcLang === project.srcLang && resource.tgtLang === project.tgtLang;
}
