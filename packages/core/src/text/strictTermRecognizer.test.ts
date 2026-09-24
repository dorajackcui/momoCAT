import { describe, expect, it, vi } from 'vitest';
import { findTermPositionsInText } from './termMatching';
import * as normalization from './termNormalization';
import { StrictTermRecognizer } from './strictTermRecognizer';

function compare(text: string, terms: string[], locale?: string) {
  const entries = terms.map((term, id) => ({ id, term }));
  const expected = entries.flatMap((entry) => {
    const positions = findTermPositionsInText(text, entry.term, { locale });
    return positions.length ? [{ entry, positions }] : [];
  });
  expect(new StrictTermRecognizer(entries, (entry) => entry.term, { locale }).scan(text)).toEqual(
    expected,
  );
}

describe('strict multi-term recognition', () => {
  it.each([
    [
      'zh-CN',
      '暖暖的花园与花园，Settings unset Settings。',
      ['花园', '暖暖的花园', 'Settings', 'set', '花园'],
    ],
    ['ja-JP', 'カタカナ ｶﾀｶﾅ、花園', ['カタカナ', '花園', 'カタ']],
    ['ko-KR', '한국어 테스트', ['한국어', '테스트']],
    ['fr-FR', 'l’été ＡＰＩ APIx API\u00a0 key', ['été', 'API', 'api key', 'APIx']],
    ['tr-TR', 'İSTANBUL istanbul I ı', ['istanbul', 'I', 'ı', 'i']],
    ['zh-CN', 'Ａ\t\nＢ 😀 Ｃ 𠮷野家 ﬃ', ['A B', '😀', '𠮷野家', 'ffi', 'C']],
  ] as Array<[string, string, string[]]>)(
    'preserves strict matching for %s',
    (locale, text, terms) => {
      compare(text, terms, locale);
    },
  );

  it('keeps suffix matches, duplicates, entry order and non-overlapping occurrences', () => {
    compare('aaaaa ushers she he', ['he', 'she', 'hers', 'ushers', 'aa', 'a', 'aa'], 'zh-CN');
    compare('哈哈哈哈哈', ['哈哈哈', '哈哈', '哈', '哈哈'], 'zh-CN');
  });

  it('infers locale per term and ignores empty patterns', () => {
    compare('漢字 カタカナ 한국어 API ß Σ ς', [
      '',
      ' ',
      '漢字',
      'カタカナ',
      '한국어',
      'API',
      'ß',
      'Σ',
    ]);
    expect(new StrictTermRecognizer([], String).scan('anything')).toEqual([]);
  });

  it('agrees with exhaustive matching on deterministic mixed-script samples', () => {
    let seed = 712367;
    const random = (max: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % max;
    };
    const chars = ['花', '园', '哈', 'Ａ', 'a', 'B', ' ', '\t', 'İ', 'i', '😀', '𠮷', 'ﬃ', 'ς'];
    for (let trial = 0; trial < 70; trial++) {
      const text = Array.from({ length: 24 }, () => chars[random(chars.length)]).join('');
      const terms = Array.from({ length: 18 }, () => {
        const start = random(text.length);
        return text.slice(start, start + 1 + random(5));
      });
      compare(text, terms, [undefined, 'zh-CN', 'tr-TR'][trial % 3]);
    }
  });

  it('does not renormalize every absent term on each row', () => {
    const entries = Array.from({ length: 5000 }, (_, index) => `未出现术语${index}`);
    const recognizer = new StrictTermRecognizer(entries, String, { locale: 'zh-CN' });
    const normalize = vi.spyOn(normalization, 'normalizeTextWithIndexMap');
    try {
      for (let row = 0; row < 100; row++) expect(recognizer.scan(`普通正文${row}`)).toEqual([]);
      expect(normalize.mock.calls.length).toBeLessThanOrEqual(100);
    } finally {
      normalize.mockRestore();
    }
  });
});
