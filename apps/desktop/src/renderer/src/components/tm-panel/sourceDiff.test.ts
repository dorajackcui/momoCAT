import { describe, expect, it } from 'vitest';
import type { Token } from '@cat/core/models';
import { buildSourceDiff } from './sourceDiff';

function textTokens(content: string): Token[] {
  return [{ type: 'text', content }];
}

describe('buildSourceDiff', () => {
  it('keeps identical sources unchanged', () => {
    expect(
      buildSourceDiff(textTokens('Same source.'), textTokens('Same source.'), 'en-US'),
    ).toEqual([{ kind: 'equal', text: 'Same source.' }]);
  });

  it('shows Latin replacements as removed TM words and added current words', () => {
    expect(
      buildSourceDiff(textTokens('The quick fox'), textTokens('The agile fox'), 'en-US'),
    ).toEqual([
      { kind: 'equal', text: 'The ' },
      { kind: 'remove', text: 'quick' },
      { kind: 'add', text: 'agile' },
      { kind: 'equal', text: ' fox' },
    ]);
  });

  it('highlights CJK changes at grapheme level', () => {
    expect(buildSourceDiff(textTokens('你好世界'), textTokens('你好新世界'), 'zh-CN')).toEqual([
      { kind: 'equal', text: '你好' },
      { kind: 'add', text: '新' },
      { kind: 'equal', text: '世界' },
    ]);
  });

  it('preserves punctuation and whitespace in the diff', () => {
    expect(
      buildSourceDiff(textTokens('Hello, world'), textTokens('Hello world!'), 'en-US'),
    ).toEqual([
      { kind: 'equal', text: 'Hello' },
      { kind: 'remove', text: ',' },
      { kind: 'equal', text: ' world' },
      { kind: 'add', text: '!' },
    ]);
  });

  it('treats CAT tags as indivisible units', () => {
    const tmSource: Token[] = [
      { type: 'text', content: 'Open ' },
      { type: 'tag', content: '{1}', meta: { id: 'tag-1', tagType: 'standalone' } },
      { type: 'text', content: ' menu' },
    ];

    expect(buildSourceDiff(tmSource, textTokens('Open  menu'), 'en-US')).toEqual([
      { kind: 'equal', text: 'Open ' },
      { kind: 'remove', text: '{1}' },
      { kind: 'equal', text: ' menu' },
    ]);
  });

  it('falls back to a bounded coarse diff for very distant long sources', () => {
    const tmSource = '旧'.repeat(300);
    const currentSource = '新'.repeat(300);

    expect(buildSourceDiff(textTokens(tmSource), textTokens(currentSource), 'zh-CN')).toEqual([
      { kind: 'remove', text: tmSource },
      { kind: 'add', text: currentSource },
    ]);
  });
});
