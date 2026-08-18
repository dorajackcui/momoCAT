import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Segment } from '@cat/core/models';
import { describe, expect, it } from 'vitest';
import {
  EditorRow,
  hasRefinableTargetText,
  normalizeRefinementInstruction,
  parseVisualizedNonPrintingSymbols,
  shouldSyncDraftFromExternalTarget,
  shouldShowAIRefineControl,
  visualizeNonPrintingSymbols,
} from './EditorRow';
import { resolveEditorRowShortcutAction } from './editor-row/useEditorRowCommandHandlers';
import {
  getEditorRowStatusLineClass,
  getEditorRowStatusTitle,
} from './editor-row/useEditorRowDisplayModel';

describe('EditorRow AI refine decisions', () => {
  it('identifies refinable target text correctly', () => {
    expect(hasRefinableTargetText('existing translation')).toBe(true);
    expect(hasRefinableTargetText('  existing translation  ')).toBe(true);
    expect(hasRefinableTargetText('')).toBe(false);
    expect(hasRefinableTargetText('   ')).toBe(false);
  });

  it('shows refine control only when row is active and target has text', () => {
    expect(shouldShowAIRefineControl(true, 'existing translation')).toBe(true);
    expect(shouldShowAIRefineControl(true, '   ')).toBe(false);
    expect(shouldShowAIRefineControl(false, 'existing translation')).toBe(false);
  });

  it('normalizes refine instruction before submit', () => {
    expect(normalizeRefinementInstruction('  make it concise  ')).toBe('make it concise');
    expect(normalizeRefinementInstruction('   ')).toBe('');
  });

  it('visualizes non-printing symbols with distinct markers', () => {
    const input = 'A B\u00A0C\u202FD\tE\nF';
    expect(visualizeNonPrintingSymbols(input)).toBe('A·B⍽C⎵D⇥E↵\nF');
  });

  it('parses visualized non-printing symbols back to raw text', () => {
    const visualized = 'A·B⍽C⎵D⇥E↵\nF';
    expect(parseVisualizedNonPrintingSymbols(visualized)).toBe('A B\u00A0C\u202FD\tE\nF');
  });
});

describe('EditorRow layout containment', () => {
  it('keeps long context constrained to the target column', () => {
    const segment: Segment = {
      segmentId: 'layout-long-context',
      fileId: 1,
      orderIndex: 0,
      sourceTokens: [{ type: 'text', content: 'Source text' }],
      targetTokens: [],
      status: 'new',
      tagsSignature: '',
      matchKey: 'source text',
      srcHash: 'source-text',
      meta: {
        updatedAt: '2026-06-02T00:00:00.000Z',
        context: `${'Very long context '.repeat(80)}tail`,
      },
    };

    const html = renderToStaticMarkup(
      React.createElement(EditorRow, {
        segment,
        rowNumber: 1,
        isActive: true,
        onActivate: () => undefined,
        onChange: () => undefined,
        onTargetEditorControllerChange: () => undefined,
        onAITranslate: () => undefined,
        onAIRefine: () => undefined,
        onConfirm: () => undefined,
      }),
    );

    expect(html).toContain('grid-cols-[30px_minmax(0,1fr)_4px_minmax(0,1fr)]');
    expect(html).toContain('min-w-0 overflow-hidden');
    expect(html).toContain('truncate whitespace-nowrap');
  });
});

describe('EditorRow draft sync gating', () => {
  it('syncs while active textarea is focused when external text changes', () => {
    expect(
      shouldSyncDraftFromExternalTarget({
        isDraftSyncSuspended: false,
        draftText: 'old',
        targetEditorText: 'new',
        isActive: true,
      }),
    ).toBe(true);
  });

  it('syncs when active row is not focused (TM/TB apply scenario)', () => {
    expect(
      shouldSyncDraftFromExternalTarget({
        isDraftSyncSuspended: false,
        draftText: 'old',
        targetEditorText: 'new',
        isActive: true,
      }),
    ).toBe(true);
  });

  it('syncs for inactive row when text changed', () => {
    expect(
      shouldSyncDraftFromExternalTarget({
        isDraftSyncSuspended: false,
        draftText: 'old',
        targetEditorText: 'new',
        isActive: false,
      }),
    ).toBe(true);
  });

  it('syncs when blur flush window is active but row is still active', () => {
    expect(
      shouldSyncDraftFromExternalTarget({
        isDraftSyncSuspended: true,
        draftText: 'old',
        targetEditorText: 'new',
        isActive: true,
      }),
    ).toBe(true);
  });

  it('does not sync when blur flush window is active and row is inactive', () => {
    expect(
      shouldSyncDraftFromExternalTarget({
        isDraftSyncSuspended: true,
        draftText: 'old',
        targetEditorText: 'new',
        isActive: false,
      }),
    ).toBe(false);
  });

  it('does not sync when draft already equals external text', () => {
    expect(
      shouldSyncDraftFromExternalTarget({
        isDraftSyncSuspended: false,
        draftText: 'same',
        targetEditorText: 'same',
        isActive: true,
      }),
    ).toBe(false);
  });
});

describe('EditorRow keyboard shortcut decisions', () => {
  it('resolves confirm command for ctrl/cmd + enter', () => {
    expect(
      resolveEditorRowShortcutAction({
        key: 'Enter',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      }),
    ).toEqual({ type: 'confirm' });

    expect(
      resolveEditorRowShortcutAction({
        key: 'Enter',
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
      }),
    ).toEqual({ type: 'confirm' });
  });

  it('resolves insert tag commands for ctrl/cmd + shift + number', () => {
    expect(
      resolveEditorRowShortcutAction({
        key: '1',
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
      }),
    ).toEqual({ type: 'insertTag', tagIndex: 0 });

    expect(
      resolveEditorRowShortcutAction({
        key: '9',
        ctrlKey: false,
        metaKey: true,
        shiftKey: true,
      }),
    ).toEqual({ type: 'insertTag', tagIndex: 8 });
  });

  it('resolves insert all tags for ctrl/cmd + shift + 0/)', () => {
    expect(
      resolveEditorRowShortcutAction({
        key: '0',
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
      }),
    ).toEqual({ type: 'insertAllTags' });

    expect(
      resolveEditorRowShortcutAction({
        key: ')',
        ctrlKey: false,
        metaKey: true,
        shiftKey: true,
      }),
    ).toEqual({ type: 'insertAllTags' });
  });
});

describe('EditorRow status display decisions', () => {
  it('maps status/qa state to status line classes', () => {
    expect(getEditorRowStatusLineClass('translated', false)).toBe('bg-brand');
    expect(getEditorRowStatusLineClass('reviewed', false)).toBe('bg-info');
    expect(getEditorRowStatusLineClass('confirmed', false)).toBe('bg-success');
    expect(getEditorRowStatusLineClass('draft', false)).toBe('bg-warning');
    expect(getEditorRowStatusLineClass('new', false)).toBe('bg-text-faint');
    expect(getEditorRowStatusLineClass('new', true)).toBe('bg-danger');
  });

  it('includes qa suffix in status title when needed', () => {
    expect(getEditorRowStatusTitle('translated', false, false)).toBe('Status: translated');
    expect(getEditorRowStatusTitle('translated', false, true)).toBe(
      'Status: translated (QA warning)',
    );
    expect(getEditorRowStatusTitle('translated', true, false)).toBe(
      'Status: translated (QA error)',
    );
  });
});
