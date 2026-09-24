import type { SegmentQaRuleId } from '@cat/core/project';

/** Shared display order for QA settings and both result-list layouts. */
export const QA_SECTIONS: ReadonlyArray<{ label: string; ids: readonly SegmentQaRuleId[] }> = [
  { label: 'Content integrity', ids: ['tag-integrity', 'line-break', 'number', 'url'] },
  { label: 'Target text quality', ids: ['empty-target', 'chinese', 'target-text'] },
  {
    label: 'Terminology & consistency',
    ids: [
      'source-consistency',
      'target-consistency',
      'substring-consistency',
      'terminology-consistency',
    ],
  },
];

export const QA_GROUP_ORDER: ReadonlyMap<string, number> = new Map(
  QA_SECTIONS.flatMap((section) => section.ids).map((id, index) => [id, index]),
);
