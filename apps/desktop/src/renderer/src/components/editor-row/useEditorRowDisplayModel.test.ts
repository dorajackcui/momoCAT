import { describe, expect, it } from 'vitest';
import {
  buildEditorRowDisplayModel,
  getEditorRowActionVisibility,
} from './useEditorRowDisplayModel';

describe('useEditorRowDisplayModel.buildEditorRowDisplayModel', () => {
  it('keeps the confirmed status color when only QA warnings are present', () => {
    const model = buildEditorRowDisplayModel({
      segmentStatus: 'confirmed',
      qaIssues: [
        {
          ruleId: 'tb-term-missing',
          severity: 'warning',
          message: 'Use the preferred term.',
        },
      ],
      isActive: false,
      draftText: 'Target',
      sourceEditorText: 'Source',
      sourceTagsCount: 0,
      sourceHighlightQuery: '',
      highlightMode: 'contains',
      showNonPrintingSymbols: false,
    });

    expect(model.statusLine).toBe('bg-success');
    expect(model.statusTitle).toBe('Status: confirmed (QA warning)');
  });

  it('builds source highlight chunks in non-printing mode', () => {
    const model = buildEditorRowDisplayModel({
      segmentStatus: 'draft',
      qaIssues: [],
      isActive: true,
      draftText: 'A B',
      sourceEditorText: 'S T',
      sourceTagsCount: 1,
      sourceHighlightQuery: 'S',
      highlightMode: 'contains',
      showNonPrintingSymbols: true,
    });

    expect(model.statusLine).toBe('bg-warning');
    expect(model.sourceHighlightChunks.some((chunk) => chunk.isMatch)).toBe(true);
    expect(model.sourceDisplayText).toContain('·');
  });

  it('keeps action visibility and status signals while editing', () => {
    const model = buildEditorRowDisplayModel({
      segmentStatus: 'translated',
      qaIssues: [],
      isActive: true,
      draftText: 'Hello',
      sourceEditorText: 'World',
      sourceTagsCount: 0,
      sourceHighlightQuery: '',
      highlightMode: 'contains',
      showNonPrintingSymbols: true,
    });

    expect(model.statusLine).toBe('bg-brand');
    expect(model.canAITranslate).toBe(true);
    expect(model.showTargetActionButtons).toBe(true);
  });
});

describe('useEditorRowDisplayModel.getEditorRowActionVisibility', () => {
  it('shows actions only when row is active and capability exists', () => {
    const inactive = getEditorRowActionVisibility({
      isActive: false,
      sourceTagsCount: 2,
      sourceEditorText: 'source',
      draftText: 'target',
    });
    expect(inactive.canInsertTags).toBe(true);
    expect(inactive.canAITranslate).toBe(true);
    expect(inactive.hasRefinableTarget).toBe(true);
    expect(inactive.showTargetActionButtons).toBe(false);

    const active = getEditorRowActionVisibility({
      isActive: true,
      sourceTagsCount: 0,
      sourceEditorText: 'source',
      draftText: '',
    });
    expect(active.canInsertTags).toBe(false);
    expect(active.canAITranslate).toBe(true);
    expect(active.hasRefinableTarget).toBe(false);
    expect(active.showTargetActionButtons).toBe(true);
  });
});
