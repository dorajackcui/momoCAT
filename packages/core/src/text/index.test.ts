import { describe, expect, it } from 'vitest';
import type { Token } from '../models';
import {
  buildTermSearchFragments,
  computeMatchKey,
  findTermPositionsInText,
  normalizeTermForLookup,
  serializeTokensToDisplayText,
  serializeTokensToSearchText,
} from './index';

describe('Text Utilities', () => {
  it('serializes tokens back to display text', () => {
    const tokens: Token[] = [
      { type: 'text', content: 'Hello ' },
      { type: 'tag', content: '{1}', meta: { id: '{1}' } },
      { type: 'text', content: ' world' },
    ];

    expect(serializeTokensToDisplayText(tokens)).toBe('Hello {1} world');
  });

  it('computes a consistent match key', () => {
    const tokens: Token[] = [
      { type: 'text', content: '  Hello  ' },
      { type: 'tag', content: '{1}', meta: { id: '{1}' } },
      { type: 'text', content: ' WORLD  ' },
    ];

    expect(computeMatchKey(tokens)).toBe('hello {TAG} world');
  });

  it('drops tags but preserves text spacing for TB matching', () => {
    const text = serializeTokensToSearchText([
      { type: 'text', content: 'API ' },
      { type: 'tag', content: '<b>' },
      { type: 'text', content: 'key' },
      { type: 'tag', content: '</b>' },
    ]);

    expect(text).toBe('API key');
  });
});

describe('Term Matching Helpers', () => {
  it('normalizes terminology lookup text with NFKC and locale-aware lowercasing', () => {
    expect(normalizeTermForLookup('  ＡＰＩ   Key  ', { locale: 'en-US' })).toBe('api key');
  });

  it('builds bounded search fragments for multilingual source text', () => {
    const fragments = buildTermSearchFragments('请保护你的ＡＰＩ key，然后打开设置页面。', {
      locale: 'zh-CN',
    });

    expect(fragments).toEqual(expect.arrayContaining(['api key', '设置页面', 'api']));
    expect(fragments.length).toBeLessThanOrEqual(12);
  });

  it('matches width-normalized latin terminology', () => {
    const positions = findTermPositionsInText('请保护你的ＡＰＩ key。', 'API key');
    expect(positions).toHaveLength(1);
    expect(positions[0].start).toBe(5);
  });
});
