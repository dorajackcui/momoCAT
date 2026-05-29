import { describe, expect, it } from 'vitest';
import type { Token } from '../models';
import {
  buildEnglishTMRecallTerms,
  buildTermSearchPlan,
  buildTermSearchPlanForLocale,
  buildTermSearchFragments,
  computeMatchKey,
  findTermPositionsInText,
  findTermPositionsInTextForLocale,
  hasEnglishTMConcordanceEvidence,
  normalizeTextForTMSimilarity,
  normalizeTermForLookup,
  resolveTMTextProfile,
  serializeTokensToDisplayText,
  serializeTokensToSearchText,
  serializeTokensToTextOnly,
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

  it('keeps tag boundaries when serializing text-only TM content', () => {
    const text = serializeTokensToTextOnly([
      { type: 'text', content: '风荷' },
      { type: 'tag', content: '{1}', meta: { id: '{1}' } },
      { type: 'text', content: '立柱' },
    ]);

    expect(text).toBe('风荷 立柱');
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

  it('uses English final-position profile variants while non-English stays strict', () => {
    expect(
      findTermPositionsInTextForLocale('Accounts are synced.', 'account', { locale: 'en-US' }),
    ).toHaveLength(1);
    expect(
      findTermPositionsInTextForLocale("User's profile opens.", 'user', { locale: 'en-US' }),
    ).toHaveLength(1);
    expect(
      findTermPositionsInTextForLocale('real-time updates are enabled.', 'real time', {
        locale: 'en-US',
      }),
    ).toHaveLength(1);
    expect(
      findTermPositionsInTextForLocale('U.S. market support is enabled.', 'US', {
        locale: 'en-US',
      }),
    ).toHaveLength(1);
    expect(
      findTermPositionsInTextForLocale('U.S. market', 'US', { locale: 'en-US' }),
    ).toHaveLength(1);
    expect(
      findTermPositionsInTextForLocale('A.P.I. limits apply.', 'API', { locale: 'en-US' }),
    ).toHaveLength(1);
    expect(
      findTermPositionsInTextForLocale('Classes start now.', 'class', { locale: 'en-US' }),
    ).toHaveLength(1);
    expect(
      findTermPositionsInTextForLocale('Buses arrive soon.', 'bus', { locale: 'en-US' }),
    ).toHaveLength(1);
    expect(
      findTermPositionsInTextForLocale('Gases expand quickly.', 'gas', { locale: 'en-US' }),
    ).toHaveLength(1);
    expect(
      findTermPositionsInTextForLocale('Quizzes start today.', 'quiz', { locale: 'en-US' }),
    ).toHaveLength(1);
    expect(
      findTermPositionsInTextForLocale('This uses memory.', 'use', { locale: 'en-US' }),
    ).toHaveLength(1);
    expect(
      findTermPositionsInTextForLocale('This causes delay.', 'cause', { locale: 'en-US' }),
    ).toHaveLength(1);
    expect(
      findTermPositionsInTextForLocale('The switch fuses shut.', 'fuse', { locale: 'en-US' }),
    ).toHaveLength(1);
    expect(
      findTermPositionsInTextForLocale('The houses are ready.', 'house', { locale: 'en-US' }),
    ).toHaveLength(1);
    expect(
      findTermPositionsInTextForLocale('The process pauses here.', 'pause', { locale: 'en-US' }),
    ).toHaveLength(1);
    expect(
      findTermPositionsInTextForLocale('This reuses memory.', 'reuse', { locale: 'en-US' }),
    ).toHaveLength(1);
    expect(
      findTermPositionsInTextForLocale('This abuses access.', 'abuse', { locale: 'en-US' }),
    ).toHaveLength(1);
    expect(
      findTermPositionsInTextForLocale('Nela Birds gather nearby.', 'Nela Bird', {
        locale: 'en-US',
      }),
    ).toHaveLength(1);
    expect(
      findTermPositionsInTextForLocale('Masquerade Lynxes appear.', 'Masquerade Lynx', {
        locale: 'en-US',
      }),
    ).toHaveLength(1);

    expect(
      findTermPositionsInTextForLocale('Accounts are synced.', 'account', { locale: 'fr-FR' }),
    ).toHaveLength(0);
    expect(
      findTermPositionsInTextForLocale('winter event', 'win', { locale: 'en-US' }),
    ).toHaveLength(0);
    expect(
      findTermPositionsInTextForLocale('Open the menu.', 'The Curator', {
        locale: 'en-US',
      }),
    ).toHaveLength(0);
    expect(
      findTermPositionsInTextForLocale('Find curator notes.', 'The Curator', {
        locale: 'en-US',
      }),
    ).toHaveLength(0);
    expect(
      findTermPositionsInTextForLocale('请检查 Accounts', 'account', { locale: 'en-US' }),
    ).toHaveLength(1);
    expect(
      findTermPositionsInTextForLocale('real time updates', 'R.E.A.L.', {
        locale: 'en-US',
      }),
    ).toHaveLength(0);
    expect(
      findTermPositionsInTextForLocale('it is ready', 'I.T.', { locale: 'en-US' }),
    ).toHaveLength(0);
  });

  it('adds English search-plan aliases without changing CJK plans', () => {
    const englishPlan = buildTermSearchPlanForLocale('Accounts use real-time U.S. settings.', {
      locale: 'en-US',
      maxFragments: 12,
    });

    expect(englishPlan.exactLookupTerms).toEqual(
      expect.arrayContaining(['account', 'real time', 'real-time', 'us']),
    );
    expect(englishPlan.ftsFragments.length).toBeLessThanOrEqual(24);

    expect(
      buildTermSearchPlanForLocale('Cases and bases are supported.', {
        locale: 'en-US',
        maxFragments: 12,
      }).exactLookupTerms,
    ).toEqual(expect.arrayContaining(['case', 'base']));

    const acronymPlan = buildTermSearchPlanForLocale('API limits apply.', {
      locale: 'en-US',
      maxFragments: 12,
    });
    expect(acronymPlan.exactLookupTerms).toEqual(expect.arrayContaining(['a.p.i.']));

    const ordinaryWordPlan = buildTermSearchPlanForLocale('real time is ready.', {
      locale: 'en-US',
      maxFragments: 12,
    });
    expect(ordinaryWordPlan.exactLookupTerms).not.toEqual(
      expect.arrayContaining(['r.e.a.l.', 't.i.m.e.', 'i.s.', 'r.e.a.d.y.']),
    );

    const mixedEnglishPlan = buildTermSearchPlanForLocale('璇锋鏌?Accounts', {
      locale: 'en-US',
      maxFragments: 12,
    });
    expect(mixedEnglishPlan.exactLookupTerms).toEqual(expect.arrayContaining(['account']));

    const pluralPlan = buildTermSearchPlanForLocale(
      'Classes, buses, cases, bases, gases, quizzes.',
      {
        locale: 'en-US',
        maxFragments: 12,
      },
    );
    expect(pluralPlan.exactLookupTerms).toEqual(
      expect.arrayContaining(['class', 'bus', 'case', 'base', 'gas', 'quiz']),
    );
    expect(pluralPlan.exactLookupTerms).not.toEqual(
      expect.arrayContaining(['classe', 'buse', 'cas', 'bas', 'gase', 'quizz']),
    );

    const usesPlan = buildTermSearchPlanForLocale('This uses memory.', {
      locale: 'en-US',
      maxFragments: 12,
    });
    expect(usesPlan.exactLookupTerms).toEqual(expect.arrayContaining(['use']));
    expect(usesPlan.exactLookupTerms).not.toEqual(expect.arrayContaining(['us']));

    const causesPlan = buildTermSearchPlanForLocale('This causes delay.', {
      locale: 'en-US',
      maxFragments: 12,
    });
    expect(causesPlan.exactLookupTerms).toEqual(expect.arrayContaining(['cause']));
    expect(causesPlan.exactLookupTerms).not.toEqual(expect.arrayContaining(['caus']));

    const fusesPlan = buildTermSearchPlanForLocale('The switch fuses shut.', {
      locale: 'en-US',
      maxFragments: 12,
    });
    expect(fusesPlan.exactLookupTerms).toEqual(expect.arrayContaining(['fuse']));
    expect(fusesPlan.exactLookupTerms).not.toEqual(expect.arrayContaining(['fus']));

    const sesSuffixPlan = buildTermSearchPlanForLocale(
      'The houses pause, reuses, and abuses checks.',
      {
        locale: 'en-US',
        maxFragments: 12,
      },
    );
    expect(sesSuffixPlan.exactLookupTerms).toEqual(
      expect.arrayContaining(['house', 'pause', 'reuse', 'abuse']),
    );
    expect(sesSuffixPlan.exactLookupTerms).not.toEqual(
      expect.arrayContaining(['hous', 'paus', 'reus', 'abus']),
    );

    const strictHeavyText = [
      'aa',
      'bb',
      'cc',
      'dd',
      'ee',
      'ff',
      'gg',
      'hh',
      'ii',
      'jj',
      'kk',
      'll',
      'mm',
      'nn',
      'oo',
      'pp',
      'qq',
      'rr',
      'ss',
      'tt',
      'uu',
      'vv',
      'ww',
      'xx',
      'yy',
      'zz',
    ].join(' ');
    const strictPlan = buildTermSearchPlan(strictHeavyText, {
      locale: 'en-US',
      maxFragments: 12,
    });
    const aliasPlan = buildTermSearchPlanForLocale(strictHeavyText, {
      locale: 'en-US',
      maxFragments: 12,
    });
    expect(aliasPlan.exactLookupTerms).toEqual(
      expect.arrayContaining(strictPlan.exactLookupTerms),
    );

    const cjkOptions = { locale: 'zh-CN', maxFragments: 12 };
    expect(buildTermSearchPlanForLocale('请检查AI、3D和奖励', cjkOptions)).toEqual(
      buildTermSearchPlan('请检查AI、3D和奖励', cjkOptions),
    );
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

describe('TM Matching Profiles', () => {
  it('resolves only English locales to the English TM profile', () => {
    expect(resolveTMTextProfile('en')).toBe('english');
    expect(resolveTMTextProfile('en-US')).toBe('english');
    expect(resolveTMTextProfile('EN-gb')).toBe('english');
    expect(resolveTMTextProfile('zh-CN')).toBe('default');
    expect(resolveTMTextProfile('ja-JP')).toBe('default');
    expect(resolveTMTextProfile('fr-FR')).toBe('default');
    expect(resolveTMTextProfile(undefined)).toBe('default');
  });

  it('keeps default TM similarity normalization equivalent to current behavior', () => {
    expect(normalizeTextForTMSimilarity('  A.P.I.   KEY  ', 'default')).toBe('a.p.i. key');
  });

  it('canonicalizes conservative English TM variants', () => {
    expect(normalizeTextForTMSimilarity('A.P.I.', 'english')).toBe('api');
    expect(normalizeTextForTMSimilarity('real-time updates', 'english')).toBe(
      'real time update',
    );
    expect(normalizeTextForTMSimilarity('Lumie Trees', 'english')).toBe('lumie tree');
    expect(normalizeTextForTMSimilarity('Masquerade Lynxes', 'english')).toBe(
      'masquerade lynx',
    );
  });

  it('builds bounded English TM recall terms without ordinary acronym overreach', () => {
    expect(buildEnglishTMRecallTerms('API limits for Lumie Trees')).toEqual(
      expect.arrayContaining(['api', 'a.p.i.', 'lumie tree', 'lumie trees']),
    );
    expect(buildEnglishTMRecallTerms('A.P.I. limits')).toEqual(expect.arrayContaining(['api']));
    expect(buildEnglishTMRecallTerms('real-time updates')).toEqual(
      expect.arrayContaining(['real time', 'real-time']),
    );
    expect(buildEnglishTMRecallTerms('real time is ready')).not.toEqual(
      expect.arrayContaining(['r.e.a.l.', 't.i.m.e.', 'i.s.', 'r.e.a.d.y.']),
    );
    expect(buildEnglishTMRecallTerms('a '.repeat(80)).length).toBeLessThanOrEqual(32);
  });

  it('requires phrase-level evidence for English TM concordance', () => {
    expect(hasEnglishTMConcordanceEvidence('Look at Lumie Tree now.', 'Lumie Tree')).toBe(
      true,
    );
    expect(hasEnglishTMConcordanceEvidence('Look at Lumie Trees now.', 'Lumie Tree')).toBe(
      true,
    );
    expect(hasEnglishTMConcordanceEvidence('Look at Lumie-Tree now.', 'Lumie Tree')).toBe(
      true,
    );
    expect(hasEnglishTMConcordanceEvidence('Tree', 'Lumie Tree')).toBe(false);
    expect(hasEnglishTMConcordanceEvidence('Open the menu.', 'The Curator')).toBe(false);
    expect(hasEnglishTMConcordanceEvidence('The value changed.', 'The Truth')).toBe(false);
    expect(hasEnglishTMConcordanceEvidence('Open the menu', 'Open the menu settings')).toBe(
      false,
    );
    expect(hasEnglishTMConcordanceEvidence('The value changed', 'The value changed now')).toBe(
      false,
    );
    expect(hasEnglishTMConcordanceEvidence('menu settings', 'open menu settings')).toBe(false);
    expect(hasEnglishTMConcordanceEvidence('menu settings', 'Open Menu Settings')).toBe(false);
    expect(hasEnglishTMConcordanceEvidence('Open Menu', 'Open Menu Settings')).toBe(false);
    expect(hasEnglishTMConcordanceEvidence('The Value Changed', 'The Value Changed Now')).toBe(
      false,
    );
  });
});
