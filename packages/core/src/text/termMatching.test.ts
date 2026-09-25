import { afterEach, describe, expect, it, vi } from 'vitest';
import { findTermPositionsInText } from './termMatching';
import { findTermPositionsInTextForLocale } from './termMatchingProfiles';

afterEach(() => vi.restoreAllMocks());

describe('term matching boundary work', () => {
  it('does not build word boundaries for absent normalized terms', () => {
    const segmenter = vi.spyOn(Intl.Segmenter.prototype, 'segment');
    expect(
      findTermPositionsInText('请检查 configuration profiles。', 'configuration settings', {
        locale: 'zh-CN',
      }),
    ).toEqual([]);
    expect(segmenter).not.toHaveBeenCalled();
  });

  it('still checks word boundaries when a substring is present', () => {
    const segmenter = vi.spyOn(Intl.Segmenter.prototype, 'segment');
    expect(
      findTermPositionsInText('settings set settings set', 'set', { locale: 'en-US' }),
    ).toEqual([
      { start: 9, end: 12 },
      { start: 22, end: 25 },
    ]);
    expect(segmenter).toHaveBeenCalledTimes(1);
  });

  it('preserves normalized matches and raw offsets', () => {
    expect(findTermPositionsInText('ＡＰＩ\t key API key', 'api key', { locale: 'en-US' })).toEqual(
      [
        { start: 0, end: 8 },
        { start: 9, end: 16 },
      ],
    );
    expect(findTermPositionsInText('İSTANBUL I ı', 'I', { locale: 'tr-TR' })).toEqual([
      { start: 9, end: 10 },
      { start: 11, end: 12 },
    ]);
  });

  it('preserves non-overlapping CJK occurrences without word segmentation', () => {
    const segmenter = vi.spyOn(Intl.Segmenter.prototype, 'segment');
    expect(findTermPositionsInText('哈哈哈哈哈', '哈哈', { locale: 'zh-CN' })).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
    expect(segmenter).not.toHaveBeenCalled();
  });

  it('still tries English variants after a strict miss', () => {
    expect(
      findTermPositionsInTextForLocale('real-time updates', 'real time', { locale: 'en-US' }),
    ).toEqual([{ start: 0, end: 9 }]);
  });

  it('retains fallback boundaries when Intl.Segmenter is unavailable', () => {
    vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined });
    try {
      expect(findTermPositionsInText('settings set', 'set', { locale: 'en-US' })).toEqual([
        { start: 9, end: 12 },
      ]);
      expect(findTermPositionsInText('settings', 'missing', { locale: 'en-US' })).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
