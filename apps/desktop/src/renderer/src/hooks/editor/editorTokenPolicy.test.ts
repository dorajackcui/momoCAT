import { describe, expect, it, vi } from 'vitest';
import type { Segment, Token } from '@cat/core/models';

import {
  appendTermToTargetTokens,
  applyTermAtEditorSelection,
  buildTermInsertionText,
  parseTargetEditorText,
} from './editorTokenPolicy';

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

  it('inserts a Latin term at the caret with boundary spacing', () => {
    expect(buildTermInsertionText('Save file', 4, 4, 'document', 'default')).toBe(' document');
    expect(buildTermInsertionText('Savefile', 4, 4, 'document', 'default')).toBe(' document ');
  });

  it('replaces the current selection instead of appending the term', () => {
    const replaceSelection = vi.fn();

    expect(
      applyTermAtEditorSelection(
        {
          getSnapshot: () => ({
            text: 'Save old file',
            selectionFrom: 5,
            selectionTo: 8,
          }),
          replaceSelection,
        },
        'document',
        'default',
      ),
    ).toBe(true);
    expect(replaceSelection).toHaveBeenCalledOnce();
    expect(replaceSelection).toHaveBeenCalledWith('document');
  });

  it('falls back when the active editor has no mounted snapshot', () => {
    const replaceSelection = vi.fn();

    expect(
      applyTermAtEditorSelection(
        {
          getSnapshot: () => null,
          replaceSelection,
        },
        'document',
        'default',
      ),
    ).toBe(false);
    expect(replaceSelection).not.toHaveBeenCalled();
  });
});
