import type { QaHighlight, QaTextRange } from '@cat/core/models';
import {
  buildHighlightChunks,
  type EditorMatchMode,
  type HighlightChunk,
} from './editorFilterUtils';

/** Search and QA use the same marks; QA ranges apply only to their exact checked text. */
export function buildEditorHighlightChunks(
  text: string,
  query: string,
  mode: EditorMatchMode,
  highlights: readonly QaHighlight[] = [],
): HighlightChunk[] {
  const search = buildHighlightChunks(text, query, mode);
  const ranges: QaTextRange[] = [];
  let offset = 0;
  for (const chunk of search) {
    if (chunk.isMatch) ranges.push({ start: offset, end: offset + chunk.text.length });
    offset += chunk.text.length;
  }
  for (const highlight of highlights) {
    if (highlight?.text !== text || !Array.isArray(highlight.ranges)) continue;
    for (const range of highlight.ranges) {
      if (
        Number.isInteger(range?.start) &&
        Number.isInteger(range?.end) &&
        range.start >= 0 &&
        range.end > range.start &&
        range.end <= text.length
      )
        ranges.push(range);
    }
  }
  if (!ranges.length) return search;
  const merged: QaTextRange[] = [];
  for (const range of ranges.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  const chunks: HighlightChunk[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor)
      chunks.push({ text: text.slice(cursor, range.start), isMatch: false });
    chunks.push({ text: text.slice(range.start, range.end), isMatch: true });
    cursor = range.end;
  }
  if (cursor < text.length) chunks.push({ text: text.slice(cursor), isMatch: false });
  return chunks;
}
