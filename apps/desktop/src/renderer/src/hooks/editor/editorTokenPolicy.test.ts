import { describe, expect, it } from 'vitest';
import type { Segment, Token } from '@cat/core/models';

import { appendTermToTargetTokens, parseTargetEditorText } from './editorTokenPolicy';

const sourceTokens: Token[] = [
  { type: 'text', content: 'Save ' },
  { type: 'tag', content: '{1}', meta: { id: '{1}' } },
];

function createSegment(targetText: string): Segment {
  return {
    segmentId: 'seg-1',
    fileId: 1,
    orderIndex: 0,
    sourceTokens,
    targetTokens: [{ type: 'text', content: targetText }],
    status: 'draft',
    tagsSignature: '',
    matchKey: 'save',
    srcHash: 'hash-seg-1',
    meta: {
      updatedAt: '2026-06-23T00:00:00.000Z',
    },
  };
}

describe('editorTokenPolicy', () => {
  it('keeps editor marker text as plain text when tag policy is none', () => {
    expect(parseTargetEditorText('Guardar {1}', sourceTokens, 'none')).toEqual([
      { type: 'text', content: 'Guardar {1}' },
    ]);
  });

  it('maps editor markers to source tags with the default tag policy', () => {
    expect(parseTargetEditorText('Guardar {1}', sourceTokens, 'default')).toEqual([
      { type: 'text', content: 'Guardar ' },
      { type: 'tag', content: '{1}', meta: { id: '{1}' } },
    ]);
  });

  it('appends applied terms as plain text when tag policy is none', () => {
    expect(appendTermToTargetTokens(createSegment('Guardar'), '<xxx>', 'none')).toEqual([
      { type: 'text', content: 'Guardar <xxx>' },
    ]);
  });

  it('does not add an extra spacer before a tag-like plain term after existing whitespace', () => {
    expect(appendTermToTargetTokens(createSegment('Guardar '), '<xxx>', 'none')).toEqual([
      { type: 'text', content: 'Guardar <xxx>' },
    ]);
  });

  it('does not add a spacer before a tag-like plain term after punctuation', () => {
    expect(appendTermToTargetTokens(createSegment('Guardar.'), '<xxx>', 'none')).toEqual([
      { type: 'text', content: 'Guardar.<xxx>' },
    ]);
  });
});
