export interface TermNormalizationOptions {
  locale?: string;
}

export const LETTER_OR_NUMBER_RE = /[\p{L}\p{N}]/u;
export const CJK_LIKE_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function normalizeTextWithIndexMap(
  value: string,
  locale?: string,
): { text: string; indexMap: number[] } {
  let normalized = '';
  const indexMap: number[] = [];
  let lastWasSpace = true;

  for (let index = 0; index < value.length; ) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) break;

    const rawChar = String.fromCodePoint(codePoint);
    const normalizedChunk = locale
      ? rawChar.normalize('NFKC').toLocaleLowerCase(locale)
      : rawChar.normalize('NFKC').toLocaleLowerCase();

    for (const chunkChar of normalizedChunk) {
      const outputChar = /\s/u.test(chunkChar) ? ' ' : chunkChar;
      if (outputChar === ' ') {
        if (lastWasSpace) continue;
        lastWasSpace = true;
      } else {
        lastWasSpace = false;
      }

      normalized += outputChar;
      indexMap.push(index);
    }

    index += rawChar.length;
  }

  if (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
    indexMap.pop();
  }

  return {
    text: normalized,
    indexMap,
  };
}

function inferLocaleFromTerm(value: string): string | undefined {
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value)) return 'ja-JP';
  if (/[\p{Script=Hangul}]/u.test(value)) return 'ko-KR';
  if (/[\p{Script=Han}]/u.test(value)) return 'zh-CN';
  return undefined;
}

export function resolveTermLocale(value: string, locale?: string): string | undefined {
  return locale || inferLocaleFromTerm(value);
}

export function normalizeTermForLookup(
  value: string,
  options?: TermNormalizationOptions,
): string {
  const locale = resolveTermLocale(value, options?.locale);
  return normalizeTextWithIndexMap(value, locale).text;
}
