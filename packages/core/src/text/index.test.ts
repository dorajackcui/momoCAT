import { describe, expect, it } from 'vitest';
import type { Token } from '../models';
import {
  buildEnglishTermRecognizer,
  buildEnglishTMConcordancePhraseTerms,
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
  resolveSourceRecallProfile,
  resolveTMTextProfile,
  serializeTokensToDisplayText,
  serializeTokensToSearchText,
  serializeTokensToSearchTextWithBoundaries,
  serializeTokensToTextOnly,
  suppressNestedTermMatches,
  type EnglishTermRecognizerEntry,
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

  it('drops tags but keeps search boundaries around non-text tokens', () => {
    const inlineTaggedText = serializeTokensToSearchText([
      { type: 'text', content: 'API' },
      { type: 'tag', content: '<b>' },
      { type: 'text', content: 'key' },
      { type: 'tag', content: '</b>' },
    ]);

    expect(inlineTaggedText).toBe('API key');

    const cjkTaggedText = serializeTokensToSearchText([
      { type: 'text', content: '喵居商店购买获得' },
      { type: 'tag', content: '{1}', meta: { id: '{1}' } },
      { type: 'tag', content: '{1}', meta: { id: '{1}' } },
      { type: 'text', content: '5.当任意单个小鱼干' },
    ]);

    expect(cjkTaggedText).toBe('喵居商店购买获得 5.当任意单个小鱼干');
  });

  it('marks hard search boundaries introduced by non-text tokens', () => {
    const tagged = serializeTokensToSearchTextWithBoundaries([
      { type: 'text', content: 'API' },
      { type: 'tag', content: '<b>' },
      { type: 'text', content: 'key' },
    ]);

    expect(tagged.text).toBe('API key');
    expect(tagged.hardBoundaryOffsets).toEqual([3]);

    const plain = serializeTokensToSearchTextWithBoundaries([
      { type: 'text', content: 'API key' },
    ]);

    expect(plain.text).toBe('API key');
    expect(plain.hardBoundaryOffsets).toEqual([]);
  });

  it('keeps boundary-aware search text equal to regular search text', () => {
    const tokens: Token[] = [
      { type: 'ws', content: '  ' },
      { type: 'text', content: '  Hello' },
      { type: 'tag', content: '{1}' },
      { type: 'text', content: 'world  ' },
    ];

    expect(serializeTokensToSearchTextWithBoundaries(tokens).text).toBe(
      serializeTokensToSearchText(tokens),
    );
    expect(serializeTokensToSearchTextWithBoundaries(tokens)).toEqual({
      text: 'Hello world',
      hardBoundaryOffsets: [5],
    });
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

  it('distributes CJK FTS fragments across later source regions under a small budget', () => {
    const fragments = buildTermSearchFragments(
      '前段说明文字用于消耗片段预算，中段继续提供更多普通描述内容，后段仍然需要覆盖结尾片段',
      {
        locale: 'zh-CN',
        maxFragments: 12,
      },
    );

    expect(fragments.length).toBeLessThanOrEqual(12);
    expect(fragments).toEqual(expect.arrayContaining(['前段说', '结尾片']));
  });

  it('distributes CJK FTS fragments to the true tail of one long token under a small budget', () => {
    const fragments = buildTermSearchFragments(
      '前段说明文字用于消耗片段预算中段继续提供更多普通描述内容后段仍然需要覆盖最终尾词',
      {
        locale: 'zh-CN',
        maxFragments: 12,
      },
    );

    expect(fragments.length).toBeLessThanOrEqual(12);
    expect(fragments).toEqual(expect.arrayContaining(['前段说', '终尾词']));
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
      expect.arrayContaining(['示例项', '通用标题', '示例', '标题']),
    );
    expect(plan.exactLookupTerms).not.toEqual(expect.arrayContaining(['示', '题']));
  });

  it('builds 2-8 character CJK exact lookup coverage for long source terminology', () => {
    const plan = buildTermSearchPlan(
      '小游戏道具可通过喵居商店购买获得，当任意单个小鱼干达到指定数量时，活动限定商店入口开放。',
      {
        locale: 'zh-CN',
        maxFragments: 12,
      },
    );

    expect(plan.exactLookupTerms).toEqual(
      expect.arrayContaining([
        '小鱼干',
        '喵居商店',
        '小游戏道具可',
        '活动限定商店入口',
      ]),
    );
    expect(plan.exactLookupTerms).not.toEqual(expect.arrayContaining(['喵', '店', '奖']));
  });

  it('builds CJK exact lookup terms from mixed-script source runs', () => {
    const plan = buildTermSearchPlan('AI喵居商店suffix 与 A股 奖', {
      locale: 'zh-CN',
      maxFragments: 12,
    });

    expect(plan.exactLookupTerms).toEqual(expect.arrayContaining(['喵居商店', 'a股']));
    expect(plan.exactLookupTerms).not.toEqual(expect.arrayContaining(['喵', '奖']));
  });

  it('adds short non-cjk and mixed-script exact lookup terms without falling back to substrings', () => {
    const plan = buildTermSearchPlan('请检查 AI、3D、A股 和 奖。', {
      locale: 'zh-CN',
      maxFragments: 18,
    });

    expect(plan.exactLookupTerms).toEqual(expect.arrayContaining(['ai', '3d', 'a股']));
    expect(plan.exactLookupTerms).not.toEqual(expect.arrayContaining(['a', '股', '奖']));
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
    ).toHaveLength(1);
    expect(
      findTermPositionsInTextForLocale('Accounts are synced.', 'account', { locale: 'zh-CN' }),
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

    const frenchProfilePlan = buildTermSearchPlanForLocale('Accounts use real-time settings.', {
      locale: 'fr-FR',
      maxFragments: 12,
    });
    expect(frenchProfilePlan.exactLookupTerms).toEqual(
      expect.arrayContaining(['account', 'real time', 'real-time']),
    );

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

  it('builds English TB recall plans from significant terms rather than broad trigram singles', () => {
    const plan = buildTermSearchPlanForLocale(
      'The intersecting streets offer plenty of room for the passing Mechadolls and the occasional frolicking Shroomseras.',
      {
        locale: 'en-US',
        maxFragments: 36,
      },
    );

    expect(plan.exactLookupTerms).toEqual(expect.arrayContaining(['shroomseras']));
    expect(plan.ftsFragments).not.toEqual(
      expect.arrayContaining(['the', 'and', 'for', 'of', 'room']),
    );
  });

  it('adds English phrase aliases to exact TB recall plans', () => {
    const plan = buildTermSearchPlanForLocale('real time update', {
      locale: 'en-US',
      maxFragments: 12,
    });

    expect(plan.exactLookupTerms).toEqual(
      expect.arrayContaining(['real time update', 'real-time update', 'real time updates']),
    );
  });

  it('retains significant single-word FTS fragments for English recall', () => {
    const plan = buildTermSearchPlanForLocale(
      'The intersecting streets offer plenty of room for the passing Mechadolls and the occasional frolicking Shroomseras.',
      { locale: 'en-US', maxFragments: 36 },
    );

    expect(plan.ftsFragments).toEqual(
      expect.arrayContaining(['intersecting', 'streets', 'plenty', 'passing', 'mechadolls', 'occasional', 'frolicking', 'shroomseras']),
    );
    expect(plan.ftsFragments).not.toEqual(
      expect.arrayContaining(['the', 'and', 'for', 'of', 'room']),
    );
  });

  it('recalls stopword-prefixed terms via single-word FTS fragments and article-prefix exact aliases', () => {
    const plan = buildTermSearchPlanForLocale(
      'Change Details The Self Reclaimed Backpiece The Day of Birth Dress',
      { locale: 'en-US', maxFragments: 36 },
    );

    expect(plan.ftsFragments).toEqual(
      expect.arrayContaining(['birth', 'reclaimed']),
    );
    expect(plan.exactLookupTerms).toEqual(
      expect.arrayContaining(['the day of birth']),
    );
  });

  it('generates article-prefix exact aliases for terms like the beginning', () => {
    const plan = buildTermSearchPlanForLocale(
      'In the beginning there was light',
      { locale: 'en-US', maxFragments: 36 },
    );

    expect(plan.ftsFragments).toEqual(
      expect.arrayContaining(['beginning', 'there', 'light']),
    );
    expect(plan.exactLookupTerms).toEqual(
      expect.arrayContaining(['the beginning']),
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

describe('English Term Recognizer', () => {
  const entries: EnglishTermRecognizerEntry[] = [
    {
      id: 'account',
      srcTerm: 'account',
      priority: 10,
      usageCount: 0,
    },
    {
      id: 'real-time',
      srcTerm: 'real time',
      priority: 10,
      usageCount: 0,
    },
    {
      id: 'us',
      srcTerm: 'US',
      priority: 10,
      usageCount: 0,
    },
    {
      id: 'day-of-birth',
      srcTerm: 'The Day of Birth',
      priority: 10,
      usageCount: 0,
    },
  ];

  it('recognizes canonical and conservative EN variants', () => {
    const recognizer = buildEnglishTermRecognizer(entries);
    const matches = recognizer.scan('Accounts use real-time U.S. settings. The Day of Birth opens.', {
      hardBoundaryOffsets: [],
    });

    expect(matches.map((match) => match.entry.id)).toEqual(
      expect.arrayContaining(['account', 'real-time', 'us', 'day-of-birth']),
    );
    expect(matches.find((match) => match.entry.id === 'account')?.variantKind).toBe(
      'inflection',
    );
    expect(matches.find((match) => match.entry.id === 'us')?.variantKind).toBe('acronym');
    expect(matches.find((match) => match.entry.id === 'day-of-birth')?.variantKind).toBe(
      'canonical',
    );
  });

  it('does not recognize terms across hard token boundaries', () => {
    const recognizer = buildEnglishTermRecognizer([
      {
        id: 'api-key',
        srcTerm: 'API key',
        priority: 10,
        usageCount: 0,
      },
    ]);

    expect(
      recognizer.scan('API key', {
        hardBoundaryOffsets: [3],
      }),
    ).toEqual([]);
    expect(
      recognizer.scan('API key', {
        hardBoundaryOffsets: [],
      }).map((match) => match.entry.id),
    ).toEqual(['api-key']);
  });

  it('rejects disallowed punctuation between phrase tokens', () => {
    const apiKeyRecognizer = buildEnglishTermRecognizer([
      {
        id: 'api-key',
        srcTerm: 'API key',
      },
    ]);
    const skyRedRecognizer = buildEnglishTermRecognizer([
      {
        id: 'sky-red',
        srcTerm: 'Sky Red',
      },
    ]);
    const usRecognizer = buildEnglishTermRecognizer([
      {
        id: 'us',
        srcTerm: 'US',
      },
    ]);

    expect(apiKeyRecognizer.scan('API/key', { hardBoundaryOffsets: [] })).toEqual([]);
    expect(apiKeyRecognizer.scan('API: key', { hardBoundaryOffsets: [] })).toEqual([]);
    expect(apiKeyRecognizer.scan('API. key', { hardBoundaryOffsets: [] })).toEqual([]);
    expect(skyRedRecognizer.scan('Sky, Red', { hardBoundaryOffsets: [] })).toEqual([]);
    expect(
      usRecognizer.scan('U.S.', {
        hardBoundaryOffsets: [],
      }).map((match) => [match.entry.id, match.variantKind, match.start, match.end]),
    ).toEqual([['us', 'acronym', 0, 3]]);
    expect(usRecognizer.scan('U-S', { hardBoundaryOffsets: [] })).toEqual([]);
  });

  it('keeps boundary-adjacent single terms and original offsets', () => {
    const recognizer = buildEnglishTermRecognizer([
      {
        id: 'api',
        srcTerm: 'API',
      },
      {
        id: 'key',
        srcTerm: 'key',
      },
    ]);

    expect(
      recognizer.scan('API key', {
        hardBoundaryOffsets: [3],
      }).map((match) => ({
        id: match.entry.id,
        start: match.start,
        end: match.end,
      })),
    ).toEqual([
      { id: 'api', start: 0, end: 3 },
      { id: 'key', start: 4, end: 7 },
    ]);

    expect(
      buildEnglishTermRecognizer([
        {
          id: 'api',
          srcTerm: 'API',
        },
      ])
        .scan('ＡＰＩ key', {
          hardBoundaryOffsets: [],
        })
        .map((match) => ({ start: match.start, end: match.end })),
    ).toEqual([{ start: 0, end: 3 }]);
  });

  it('recognizes leading article add and remove variants', () => {
    const recognizer = buildEnglishTermRecognizer([
      {
        id: 'beginning',
        srcTerm: 'Beginning',
      },
      {
        id: 'day',
        srcTerm: 'The Day of Birth',
      },
    ]);

    expect(
      recognizer.scan('In the beginning there was light.', {
        hardBoundaryOffsets: [],
      }).find((match) => match.entry.id === 'beginning')?.variantKind,
    ).toBe('article');
    expect(
      recognizer.scan('Day of Birth', {
        hardBoundaryOffsets: [],
      }).find((match) => match.entry.id === 'day')?.variantKind,
    ).toBe('article');
  });

  it('keeps recognizer ordering deterministic', () => {
    const recognizer = buildEnglishTermRecognizer([
      {
        id: 'short',
        srcTerm: 'Birth',
        priority: 10,
        usageCount: 0,
      },
      {
        id: 'long',
        srcTerm: 'The Day of Birth',
        priority: 10,
        usageCount: 0,
      },
    ]);

    expect(
      recognizer.scan('The Day of Birth', {
        hardBoundaryOffsets: [],
      }).map((match) => match.entry.id),
    ).toEqual(['long', 'short']);
  });
});

describe('TM Matching Profiles', () => {
  const HEARTBEAT_ZONE_LONG_SOURCE =
    'Gravity is abnormal in the Heartbeat Zone. After Nikki enters, she will become weightless and float in the air, wrapped in a bubble. Moving while floating consumes Drifting Power. If Drifting Power runs out, the bubble will automatically pop. When Drifting Power is full, movement speed increases for a certain time, and moving during this period will not consume Drifting Power. After the acceleration ends, a certain amount of Drifting Power will be deducted.|Four different Music Bubbles float within the Heartbeat Zone: Heartstring Bubbles increase Drifting Power and Heartstrings; Speed Bubbles allow Nikki dash forward quickly for a short distance and grant a small amount of Drifting Power and Heartstrings; Fish Bubbles spit out many Heartstring Bubbles, which can be collected to gain extra Heartstrings; Spike Bubbles stop Nikki in place for a short time and reduce Drifting Power.|Heartstrings can also be obtained by playing with the Bom-Bom Bubble Machine in the Rest Zone or sitting in viewing chairs to enjoy the meteors. Besides the activities that grant Heartstrings, the stage lights can also be controlled to reveal dazzling changes of light and shadow.';

  it('resolves project source recall profiles from source locale only', () => {
    expect(resolveSourceRecallProfile('zh-CN')).toBe('cjk');
    expect(resolveSourceRecallProfile('ja-JP')).toBe('cjk');
    expect(resolveSourceRecallProfile('ko')).toBe('cjk');
    expect(resolveSourceRecallProfile('cmn-Hans-CN')).toBe('cjk');
    expect(resolveSourceRecallProfile('yue-Hant-HK')).toBe('cjk');

    expect(resolveSourceRecallProfile('en')).toBe('en');
    expect(resolveSourceRecallProfile('en-US')).toBe('en');
    expect(resolveSourceRecallProfile('fr-FR')).toBe('en');
    expect(resolveSourceRecallProfile('de-DE')).toBe('en');
    expect(resolveSourceRecallProfile(undefined)).toBe('en');
  });

  it('routes CJK TM to default and non-CJK TM to the English profile', () => {
    expect(resolveTMTextProfile('zh-CN')).toBe('default');
    expect(resolveTMTextProfile('ja-JP')).toBe('default');
    expect(resolveTMTextProfile('ko-KR')).toBe('default');
    expect(resolveTMTextProfile('en')).toBe('english');
    expect(resolveTMTextProfile('en-US')).toBe('english');
    expect(resolveTMTextProfile('EN-gb')).toBe('english');
    expect(resolveTMTextProfile('fr-FR')).toBe('english');
    expect(resolveTMTextProfile(undefined)).toBe('english');
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
    expect(normalizeTextForTMSimilarity('This does news updates.', 'english')).toBe(
      'this does news update',
    );
    expect(normalizeTextForTMSimilarity('Series species analysis.', 'english')).toBe(
      'series species analysis',
    );
    expect(normalizeTextForTMSimilarity('Buzzes Fizzes Jazzes Quizzes.', 'english')).toBe(
      'buzz fizz jazz quiz',
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
    expect(buildEnglishTMRecallTerms('This does news updates.')).not.toEqual(
      expect.arrayContaining(['thi', 'doe', 'new']),
    );
    expect(buildEnglishTMRecallTerms('buzz fizz jazz quiz')).toEqual(
      expect.arrayContaining(['buzzes', 'fizzes', 'jazzes', 'quizzes']),
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
    expect(hasEnglishTMConcordanceEvidence('Look at lumie tree now.', 'lumie tree')).toBe(
      false,
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

  it('builds bounded English TM concordance phrase terms from named phrases', () => {
    const terms = buildEnglishTMConcordancePhraseTerms(HEARTBEAT_ZONE_LONG_SOURCE);

    expect(terms.exactPhrases).toEqual(
      expect.arrayContaining([
        'Heartbeat Zone',
        'Drifting Power',
        'Music Bubbles',
        'Heartstring Bubbles',
        'Speed Bubbles',
        'Fish Bubbles',
        'Spike Bubbles',
        'Rest Zone',
      ]),
    );
    expect(terms.ftsPhrases).toEqual(
      expect.arrayContaining([
        'heartbeat zone',
        'drifting power',
        'music bubbles',
        'heartstring bubbles',
        'speed bubbles',
        'fish bubbles',
        'spike bubbles',
        'rest zone',
      ]),
    );
    expect(terms.exactPhrases).not.toContain('Zone');
    expect(terms.ftsPhrases).not.toContain('zone');
    expect(new Set(terms.exactPhrases).size).toBe(terms.exactPhrases.length);
    expect(new Set(terms.ftsPhrases).size).toBe(terms.ftsPhrases.length);
    expect(terms.exactPhrases.length).toBeLessThanOrEqual(24);
    expect(terms.ftsPhrases.length).toBeLessThanOrEqual(48);
  });

  it('keeps English concordance phrase extraction conservative', () => {
    expect(buildEnglishTMConcordancePhraseTerms('menu settings are open')).toEqual({
      exactPhrases: [],
      ftsPhrases: [],
    });

    expect(
      buildEnglishTMConcordancePhraseTerms('Open Menu Settings can be changed.').ftsPhrases,
    ).toEqual(expect.arrayContaining(['open menu settings']));

    expect(
      buildEnglishTMConcordancePhraseTerms('After Nikki enters, Drifting Power fills.').ftsPhrases,
    ).toEqual(expect.arrayContaining(['drifting power']));
    expect(
      buildEnglishTMConcordancePhraseTerms('After Nikki enters, Drifting Power fills.').ftsPhrases,
    ).not.toEqual(expect.arrayContaining(['after nikki']));
  });

  it('does not build English concordance phrases across punctuation boundaries', () => {
    for (const separator of [', ', ' - ', ' / ', '\n', '\r\n', ' \u2014 ', '. ']) {
      const terms = buildEnglishTMConcordancePhraseTerms(`Blue Sky${separator}Red Moon`);

      expect(terms.ftsPhrases).toEqual(expect.arrayContaining(['blue sky', 'red moon']));
      expect(terms.ftsPhrases).not.toEqual(expect.arrayContaining(['sky red']));
    }

    expect(buildEnglishTMConcordancePhraseTerms('Blue Sky Red Moon').ftsPhrases).toEqual(
      expect.arrayContaining(['sky red']),
    );
  });

  it('preserves token-internal punctuation before segment boundary checks', () => {
    expect(buildEnglishTMConcordancePhraseTerms('U.S. Coast Guard').ftsPhrases).toEqual(
      expect.arrayContaining([normalizeTextForTMSimilarity('U.S. Coast Guard', 'english')]),
    );
    expect(
      buildEnglishTMConcordancePhraseTerms('Bom-Bom Bubble Machine').ftsPhrases,
    ).toEqual(expect.arrayContaining(['bom bom bubble machine']));
    expect(
      buildEnglishTMConcordancePhraseTerms("Nikki's Dream Wardrobe").ftsPhrases,
    ).toEqual(expect.arrayContaining(['nikki dream wardrobe']));
    expect(
      buildEnglishTMConcordancePhraseTerms('Bom\u2011Bom Bubble Machine').ftsPhrases,
    ).toEqual(expect.arrayContaining(['bom bom bubble machine']));
    expect(
      buildEnglishTMConcordancePhraseTerms('Nikki\u2019s Dream Wardrobe').ftsPhrases,
    ).toEqual(expect.arrayContaining(['nikki dream wardrobe']));

    for (const hyphen of ['\u2010', '\u2011', '\u2012', '\u2013']) {
      expect(
        buildEnglishTMConcordancePhraseTerms(`Bom${hyphen}Bom Bubble Machine`).ftsPhrases,
      ).toEqual(expect.arrayContaining(['bom bom bubble machine']));
    }
  });

  it('allows internal stopwords in named English concordance phrases', () => {
    const terms = buildEnglishTMConcordancePhraseTerms(
      'Sea of Stars. Path of Exile. Legend of Zelda.',
    );

    expect(terms.ftsPhrases).toEqual(
      expect.arrayContaining(['sea of stars', 'path of exile', 'legend of zelda']),
    );
    expect(
      buildEnglishTMConcordancePhraseTerms('After Sea of Stars.').ftsPhrases,
    ).not.toEqual(expect.arrayContaining(['after sea of stars']));
  });
});
