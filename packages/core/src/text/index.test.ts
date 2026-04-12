import { describe, expect, it } from 'vitest';
import type { Token } from '../models';
import {
  buildTermSearchPlan,
  buildTermSearchFragments,
  computeMatchKey,
  findTermPositionsInText,
  normalizeTermForLookup,
  serializeTokensToDisplayText,
  serializeTokensToSearchText,
  suppressNestedTermMatches,
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
    expect(fragments.length).toBeLessThanOrEqual(24);
  });

  it('returns mixed 2/3/4-character CJK fragments for long Chinese source text', () => {
    const fragments = buildTermSearchFragments(
      '赛事公告说明领奖台区域将在闭幕式开始前开放，获奖名单与奖章组会同时完成终审流程。',
      {
        locale: 'zh-CN',
        maxFragments: 24,
      },
    );

    expect(fragments).toEqual(
      expect.arrayContaining(['赛事', '获奖名', '获奖名单']),
    );
  });

  it('covers adjacent Chinese terms separated by punctuation while keeping short CJK fragments in budget', () => {
    const fragments = buildTermSearchFragments(
      '完成主线任务后，可获得限定称号【示例项·通用标题】，并在公告页查看领奖台安排。',
      {
        locale: 'zh-CN',
        maxFragments: 18,
      },
    );

    expect(fragments).toEqual(
      expect.arrayContaining(['示例项', '通用标题']),
    );
    expect(fragments.some((fragment) => fragment.length === 3)).toBe(true);
  });

  it('builds a unified search plan with exact lookup terms for FTS blind spots', () => {
    const plan = buildTermSearchPlan('完成任务后可获得限定称号【示例项·通用标题】', {
      locale: 'zh-CN',
      maxFragments: 18,
    });

    expect(plan.ftsFragments).toEqual(
      expect.arrayContaining(['示例项', '通用标题']),
    );
    expect(plan.exactLookupTerms).toEqual(
      expect.arrayContaining(['示例项', '通用标题', '示例', '标题', '示', '题']),
    );
  });

  it('adds short non-cjk and mixed-script exact lookup terms without falling back to substrings', () => {
    const plan = buildTermSearchPlan('请检查 AI、3D、A股 和 奖。', {
      locale: 'zh-CN',
      maxFragments: 18,
    });

    expect(plan.exactLookupTerms).toEqual(
      expect.arrayContaining(['ai', '3d', 'a股', '奖']),
    );
    expect(plan.exactLookupTerms).not.toEqual(expect.arrayContaining(['a', '股']));
  });

  it('matches width-normalized latin terminology', () => {
    const positions = findTermPositionsInText('请保护你的ＡＰＩ key。', 'API key');
    expect(positions).toHaveLength(1);
    expect(positions[0].start).toBe(5);
  });

  it('suppresses only fully nested shorter matches and keeps partial overlaps', () => {
    const matches = suppressNestedTermMatches([
      {
        id: 'long',
        positions: [{ start: 4, end: 8 }],
      },
      {
        id: 'nested',
        positions: [{ start: 4, end: 6 }],
      },
      {
        id: 'partial',
        positions: [{ start: 6, end: 10 }],
      },
    ]);

    expect(matches).toHaveLength(2);
    expect(matches.map((match) => match.id)).toEqual(['long', 'partial']);
  });
});
