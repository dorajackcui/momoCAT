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

  it('maps the outer g tags to paired markers and restores the nested attribute verbatim', () => {
    const opening = '❮g equiv-text="❰cf Color="#112233"❱"❯';
    const source = `${opening}Hello❮/g❯`;
    const tokens = parseDisplayTextToTokens(source);
    const manager = new TagManager();

    expect(tokens).toEqual([
      { type: 'tag', content: opening, meta: { id: opening } },
      { type: 'text', content: 'Hello' },
      { type: 'tag', content: '❮/g❯', meta: { id: '❮/g❯' } },
    ]);
    expect(manager.findPairedTag(tokens, 0)).toBe(2);
    expect(manager.findPairedTag(tokens, 2)).toBe(0);
    expect(serializeTokensToEditorText(tokens, tokens)).toBe('{1>Hello<2}');
    expect(parseEditorTextToTokens(source, tokens)).toEqual(tokens);
    expect(parseEditorTextToTokens('{1>Hello<2}', tokens)).toEqual(tokens);
    expect(serializeTokensToDisplayText(tokens)).toBe(source);
  });

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
    '<g title="2 > 1" other = "quoted value">',
    "❮g title='2 ❱ 1'❯",
    '<g equiv-text="<g equiv-text="<cf Color="#112233">" id="1">">',
    '❰g equiv-text="<b>nested</b>"❱',
    '<g title="do not split {1} %s \\n" path="a/b">',
    '<g title="a < b > c">',
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

  it.each([
    '<g title="unfinished>bad',
    '❮g title="unfinished❯bad',
    '<g title="a<b c">',
    '<g title="a < b = ">',
    "❮g title='a❰b c'❯",
  ])('leaves incomplete nesting literal without guessing recovery boundaries: %s', (prefix) => {
    const source = `${prefix}<b>Next</b>`;
    const expected = [{ type: 'text', content: source }];

    expect(parseDisplayTextToTokens(source)).toEqual(expected);
    expect(parseEditorTextToTokens(source, [])).toEqual(expected);
  });

  it.each([
    { name: 'angle tags', chunk: '<g x=">', count: 8_000, tagCount: 0 },
    { name: 'mixed placeholders', chunk: '{placeholder}<g x=">', count: 2_000, tagCount: 2_000 },
  ])('handles long incomplete $name without rescanning the suffix', ({ chunk, count, tagCount }) => {
    const source = chunk.repeat(count);
    const start = performance.now();
    const displayTokens = parseDisplayTextToTokens(source);
    const editorTokens = parseEditorTextToTokens(source, []);
    const elapsed = performance.now() - start;

    expect(displayTokens.filter(token => token.type === 'tag')).toHaveLength(tagCount);
    expect(serializeTokensToDisplayText(displayTokens)).toBe(source);
    expect(editorTokens).toEqual(displayTokens);
    // Generous headroom for slower hosts; rescanning this suffix takes seconds.
    expect(elapsed).toBeLessThan(1_000);
  });

  it('does not resume an incomplete angle scan after an independent placeholder', () => {
    const source = '<g title="unfinished {name}<b>Next</b>';
    const expected = [
      { type: 'text', content: '<g title="unfinished ' },
      { type: 'tag', content: '{name}', meta: { id: '{name}' } },
      { type: 'text', content: '<b>Next</b>' },
    ];

    expect(parseDisplayTextToTokens(source)).toEqual(expected);
    expect(parseEditorTextToTokens(source, [])).toEqual(expected);
  });

  it('advances cached angle and escape matches across other tag types', () => {
    const opening = '❮g equiv-text="❰cf Color="#112233"❱"❯';
    const source = `{name}${opening}A❮/g❯\\n{next}${opening}B❮/g❯\\r`;
    const tokens = parseDisplayTextToTokens(source);

    expect(tokens.map(token => token.content)).toEqual([
      '{name}', opening, 'A', '❮/g❯', '\\n', '{next}', opening, 'B', '❮/g❯', '\\r',
    ]);
    expect(parseEditorTextToTokens(source, [])).toEqual(tokens);
    expect(parseEditorTextToTokens(serializeTokensToEditorText(tokens, tokens), tokens)).toEqual(tokens);
    expect(parseDisplayTextToTokens(source)).toEqual(tokens);
  });

  it('recognizes later raw tags after editor markers', () => {
    const sourceTokens = parseDisplayTextToTokens('<b>A</b>');
    const editorText = '{1>A<2} <i>B</i>';
    const tokens = parseEditorTextToTokens(editorText, sourceTokens);

    expect(serializeTokensToDisplayText(tokens)).toBe('<b>A</b> <i>B</i>');
    expect(tokens.filter(token => token.type === 'tag').map(token => token.content))
      .toEqual(['<b>', '</b>', '<i>', '</i>']);
  });

  it.each(['<g missing-end ', '❮g equiv-text="❰b❱"'])(
    'starts a new outer tag after an unquoted unfinished prefix: %s', (prefix) => {
      const source = `${prefix}<b>A</b>`;
      const expected = [{ type: 'text', content: prefix }, ...parseDisplayTextToTokens('<b>A</b>')];
      expect(parseDisplayTextToTokens(source)).toEqual(expected);
      expect(parseEditorTextToTokens(source, [])).toEqual(expected);
    },
  );

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
