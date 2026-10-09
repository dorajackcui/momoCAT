import { useEffect, useState } from 'react';

import type { Segment } from '@cat/core/models';
import { serializeTokensToEditorText } from '@cat/core/tag';
import { feedbackService } from '../../services/feedbackService';
import { parseSegmentClipboard, serializeSegmentClipboard } from './segmentClipboard';

type ClipboardInputEvent = Pick<
  ClipboardEvent,
  'target' | 'clipboardData' | 'preventDefault' | 'stopPropagation'
>;
interface Params {
  fileId: number;
  orderedIds: readonly string[];
  selectedIds: ReadonlySet<string>;
  isRowSelection: boolean;
  disabled: boolean;
  getSegment: (id: string) => Segment | undefined;
  pasteSegments: (ids: string[], targets: string[]) => Promise<void>;
}

export function useEditorClipboard({
  fileId,
  orderedIds,
  selectedIds,
  isRowSelection,
  disabled,
  getSegment,
  pasteSegments,
}: Params) {
  const [pending, setPending] = useState<{
    fileId: number;
    ids: string[];
    text: string;
    lines: string[];
  } | null>(null);
  if (pending && pending.fileId !== fileId) setPending(null);
  const pendingPaste = pending?.fileId === fileId ? pending : null;

  const handlesRows = (eventTarget: EventTarget | null) => {
    // Chromium can dispatch clipboard events at body for a focused row gutter.
    const target =
      eventTarget === document.body || eventTarget === document.documentElement
        ? document.activeElement
        : eventTarget;
    if (!(target instanceof HTMLElement) || !isRowSelection || !selectedIds.size) return false;
    return (
      Boolean(target.closest('.editor-scrollbar')) &&
      !target.closest('input, textarea, select, [role="dialog"], .cm-content')
    );
  };
  const orderedSelection = () => orderedIds.filter((id) => selectedIds.has(id));
  const paste = (ids: string[], targets: string[]) => {
    if (disabled) return;
    if (ids.length !== targets.length) {
      feedbackService.error(
        `Row count does not match (${targets.length} copied, ${ids.length} selected). Select the same number of segments and paste again.`,
      );
      return;
    }
    void pasteSegments(ids, targets);
  };

  const onCopy = (event: ClipboardInputEvent) => {
    if (!event.clipboardData) return;
    const target =
      event.target === document.body || event.target === document.documentElement
        ? document.activeElement
        : event.target;
    const selection = window.getSelection();
    if (
      selection &&
      !selection.isCollapsed &&
      selection.rangeCount === 1 &&
      !(
        target instanceof Element &&
        target.closest('input, textarea, select, [role="dialog"], .cm-content')
      )
    ) {
      const range = selection.getRangeAt(0);
      const start =
        range.startContainer instanceof Element
          ? range.startContainer
          : range.startContainer.parentElement;
      const preview = start?.closest('.editor-source-text, .editor-target-preview');
      if (preview?.closest('.editor-scrollbar') && preview.contains(range.endContainer)) {
        // Chromium's rendered-text copy normalizes NBSP and drops terminal line
        // breaks. DOM ranges retain the real characters, excluding CSS markers.
        event.clipboardData.setData('text/plain', range.toString());
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    if (!handlesRows(event.target) || selection?.toString()) return;
    const rows = orderedSelection().map((id): [string, string] => {
      const segment = getSegment(id);
      if (!segment) throw new Error('Selected segment is unavailable.');
      return [
        serializeTokensToEditorText(segment.sourceTokens, segment.sourceTokens),
        serializeTokensToEditorText(segment.targetTokens, segment.sourceTokens),
      ];
    });
    const content = serializeSegmentClipboard(rows);
    event.clipboardData.setData('text/plain', content.text);
    event.clipboardData.setData('text/html', content.html);
    event.preventDefault();
    event.stopPropagation();
    feedbackService.success(`Copied ${rows.length} segments (Source + Target).`);
  };

  const onPaste = (event: ClipboardInputEvent) => {
    if (!event.clipboardData || !handlesRows(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (disabled || pendingPaste) return;
    try {
      const content = parseSegmentClipboard({
        text: event.clipboardData.getData('text/plain'),
        html: event.clipboardData.getData('text/html'),
      });
      const ids = orderedSelection();
      if (content.kind === 'rows') paste(ids, content.targets);
      else if (content.text) {
        if (ids.length > 1 && content.text.includes('\n'))
          setPending({ fileId, ids, text: content.text, lines: content.lines });
        else paste(ids, [content.text]);
      }
    } catch (error) {
      feedbackService.error(error instanceof Error ? error.message : String(error));
    }
  };
  useEffect(() => {
    document.addEventListener('copy', onCopy, true);
    document.addEventListener('paste', onPaste, true);
    return () => {
      document.removeEventListener('copy', onCopy, true);
      document.removeEventListener('paste', onPaste, true);
    };
  });

  const choosePaste = (split: boolean) => {
    if (!pendingPaste) return;
    setPending(null);
    paste(
      split ? pendingPaste.ids : pendingPaste.ids.slice(0, 1),
      split ? pendingPaste.lines : [pendingPaste.text],
    );
  };
  return { onCopy, onPaste, pendingPaste, choosePaste, cancelPaste: () => setPending(null) };
}
