import { describe, expect, it } from 'vitest';
import { TagValidator } from '../qa';
import { serializeTokensToDisplayText } from '../text';
import {
  TagManager,
  getTagDisplayInfo,
  getDisplayTagPatterns,
  parseDisplayTextToTokens,
  parseEditorTextToTokens,
  serializeTokensToEditorText,
} from './index';

describe('angle tags with embedded attribute markup', () => {
  const openingTags = [
    '❮g id="0" equiv-text="❰g equiv-text="❰cf Color="#112233"❱" id="1"❱"❯',
    '❮g id="1" equiv-text="❰g equiv-text="❰cf Color="#445566"❱" id="2"❱"❯',
    '❮g id="2" equiv-text="❰g equiv-text="❰cf Color="#778899"❱" id="3"❱"❯',
  ];
  const texts = ['First block', 'Second block', 'Third block'];
  const source = openingTags.map((tag, index) => `${tag}${texts[index]}❮/g❯`).join('');

  it('keeps each nested opening tag atomic and exposes only the three text blocks', () => {
    const tokens = parseDisplayTextToTokens(source);

    expect(tokens).toEqual(openingTags.flatMap((tag, index) => [
      { type: 'tag', content: tag, meta: { id: tag } },
      { type: 'text', content: texts[index] },
      { type: 'tag', content: '❮/g❯', meta: { id: '❮/g❯' } },
    ]));
    expect(parseEditorTextToTokens(source, tokens)).toEqual(tokens);
    const editorText = '{1>First block<2}{3>Second block<2}{4>Third block<2}';
    expect(serializeTokensToEditorText(tokens, tokens)).toBe(editorText);
    expect(parseEditorTextToTokens(editorText, tokens)).toEqual(tokens);
    expect(serializeTokensToDisplayText(tokens)).toBe(source);

    const translated = parseEditorTextToTokens('{1>Un<2}{3>Deux<2}{4>Trois<2}', tokens);
    expect(new TagValidator().validate(tokens, translated).issues).toEqual([]);
    expect(serializeTokensToDisplayText(translated)).toBe(
      `${openingTags[0]}Un❮/g❯${openingTags[1]}Deux❮/g❯${openingTags[2]}Trois❮/g❯`,
    );
  });

  it('pairs tags by name while retaining attributes and original delimiters', () => {
    const manager = new TagManager();
    const tokens = parseDisplayTextToTokens(source);

    for (const index of [0, 3, 6]) {
      expect(manager.findPairedTag(tokens, index)).toBe(index + 2);
      expect(manager.findPairedTag(tokens, index + 2)).toBe(index);
      expect(getTagDisplayInfo(tokens[index].content, index).type).toBe('paired-start');
    }
  });

  it.each([
    '<g title="2 > 1 / 3 < 4">',
    "❮g title='2 ❱ 1 / 3 ❰ 4'❯",
    '<g equiv-text="<g equiv-text="<cf Color="#112233">" id="1">">',
    '❰g equiv-text="<b>nested</b>"❱',
    '<g title="do not split {1} %s \\n" path="a/b">',
    '<g title="a < b > c">',
    '<g title="a<b c">',
    "❮g title='a❰b c'❯",
    '❮g equiv-text="❰标记 value="a❱b"❱"❯',
  ])('preserves quoted content in %s', (opening) => {
    const tokens = parseDisplayTextToTokens(`${opening}Text</g>`);
    expect(tokens.map((token) => token.content)).toEqual([opening, 'Text', '</g>']);
    expect(serializeTokensToEditorText(tokens, tokens)).toBe('{1>Text<2}');
    expect(getTagDisplayInfo(opening, 0).type).toBe('paired-start');
  });

  it('tracks nested same-name tags with different attributes and ignores self-closing tags', () => {
    const tokens = parseDisplayTextToTokens('<g id="a">❮g id="b"❯<g path="a/b"/>X❰/g❱</g>');
    const manager = new TagManager();

    expect(manager.findPairedTag(tokens, 0)).toBe(5);
    expect(manager.findPairedTag(tokens, 1)).toBe(4);
    expect(manager.findPairedTag(tokens, 2)).toBeUndefined();
    expect(manager.findPairedTag(tokens, 4)).toBe(1);
    expect(manager.findPairedTag(tokens, 5)).toBe(0);
    expect(serializeTokensToEditorText(tokens, tokens)).toBe('{1>{2>{3}X<4}<5}');
  });

  it('keeps custom-pattern and none-policy parsing independent of the default scanner', () => {
    expect(parseDisplayTextToTokens(source, { tagPolicy: 'none' })).toEqual([
      { type: 'text', content: source },
    ]);
    expect(parseEditorTextToTokens(source, [], { tagPolicy: 'none' })).toEqual([
      { type: 'text', content: source },
    ]);
    expect(parseDisplayTextToTokens(source, [/@@\w+@@/g])).toEqual([
      { type: 'text', content: source },
    ]);
  });

  it('retains following tags after a quoted comparison', () => {
    const source = '<g title="a<b c">Text</g><b>Next</b>';
    const tokens = parseDisplayTextToTokens(source);

    expect(tokens.map(token => [token.type, token.content])).toEqual([
      ['tag', '<g title="a<b c">'], ['text', 'Text'], ['tag', '</g>'],
      ['tag', '<b>'], ['text', 'Next'], ['tag', '</b>'],
    ]);
    expect(parseEditorTextToTokens(source, tokens)).toEqual(tokens);
    expect(serializeTokensToEditorText(tokens, tokens)).toBe('{1>Text<2}{3>Next<4}');
  });

  it.each([
    '<g title="unfinished>bad',
    '❮g title="unfinished❯bad',
    '<g missing-end ',
  ])('recovers after an incomplete tag: %s', (prefix) => {
    const source = `${prefix}<b>Next</b>`;
    const expected = [
      { type: 'text', content: prefix },
      { type: 'tag', content: '<b>', meta: { id: '<b>' } },
      { type: 'text', content: 'Next' },
      { type: 'tag', content: '</b>', meta: { id: '</b>' } },
    ];

    expect(parseDisplayTextToTokens(source)).toEqual(expected);
    expect(parseEditorTextToTokens(source, [])).toEqual(expected);
  });

  it('preserves angle scanning when callers copy, clone, and extend default rules', () => {
    const text = `${source} @@NAME@@`;
    const expected = [
      ...parseDisplayTextToTokens(source),
      { type: 'text', content: ' ' },
      { type: 'tag', content: '@@NAME@@', meta: { id: '@@NAME@@' } },
    ];

    for (const defaults of [
      [...getDisplayTagPatterns()],
      getDisplayTagPatterns().map(pattern => new RegExp(pattern.source, pattern.flags)),
    ]) {
      const patterns = [...defaults, /@@\w+@@/g];
      expect(parseDisplayTextToTokens(text, patterns)).toEqual(expected);
      expect(parseEditorTextToTokens(text, [], { displayTagPatterns: patterns })).toEqual(expected);
    }
  });

  it('keeps a selective custom angle regex selective', () => {
    const source = '<g id="1">Text</g><br/>';
    const patterns = [/<br\/>/g];
    const expected = [
      { type: 'text', content: '<g id="1">Text</g>' },
      { type: 'tag', content: '<br/>', meta: { id: '<br/>' } },
    ];

    expect(parseDisplayTextToTokens(source, patterns)).toEqual(expected);
    expect(parseEditorTextToTokens(source, [], { displayTagPatterns: patterns })).toEqual(expected);
  });

  it.each(['❮g title="unfinished❯', '❮g equiv-text="❰b❱"', '<>'])(
    'does not emit a truncated tag for %s',
    (source) => {
      expect(parseDisplayTextToTokens(source)).toEqual([{ type: 'text', content: source }]);
      expect(parseEditorTextToTokens(source, [])).toEqual([{ type: 'text', content: source }]);
    },
  );
});
