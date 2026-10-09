import type { QaHighlight, QaIssue, QaTextRange, Segment, Token } from '../models';
import { serializeTokensToEditorParts } from '../tag/TagCodec';
import { findTermPositionsInTextForLocale } from '../text';
import { countValues, qaText, type QaMarker } from './text';

export function qaHighlight(
  side: QaHighlight['side'],
  text: string,
  ranges: QaTextRange[],
): QaHighlight[] {
  return ranges.length ? [{ side, text, ranges }] : [];
}

export function termSourceHighlight(
  tokens: Token[],
  term: string,
  locale?: string,
  positions?: QaTextRange[],
): QaHighlight[] {
  let search = '';
  let rawOffset = 0;
  const starts: number[] = [],
    ends: number[] = [];
  for (const token of tokens) {
    const content = token.type === 'text' ? token.content : ' ';
    for (let index = 0; index < content.length; index++) {
      const start = rawOffset + index;
      const end = token.type === 'text' ? start + 1 : rawOffset + token.content.length;
      const char = content[index];
      if (/\s/u.test(char)) {
        if (!search || search.endsWith(' ')) continue;
        search += ' ';
      } else search += char;
      starts.push(start);
      ends.push(end);
    }
    rawOffset += token.content.length;
  }
  if (search.endsWith(' ')) search = search.slice(0, -1);
  const ranges = (
    positions?.length ? positions : findTermPositionsInTextForLocale(search, term, { locale })
  ).map(({ start, end }) => ({
    start: starts[start],
    end: ends[end - 1],
  }));
  let tokenOffset = 0;
  const textRanges = tokens.flatMap((token) => {
    const start = tokenOffset;
    tokenOffset += token.content.length;
    return token.type === 'text'
      ? ranges.flatMap((range) => {
          const from = Math.max(start, range.start),
            to = Math.min(tokenOffset, range.end);
          return to > from ? [{ start: from, end: to }] : [];
        })
      : [];
  });
  return qaHighlight('source', qaText(tokens), textRanges);
}

export interface QaMarkerContext {
  text: string;
  markers: QaMarker[];
}

export function withTagHighlights(
  issue: QaIssue,
  source: QaMarkerContext,
  target: QaMarkerContext,
): QaIssue {
  const left = countValues(source.markers.map((marker) => marker.text));
  const right = countValues(target.markers.map((marker) => marker.text));
  const ranges = (context: QaMarkerContext, side: QaHighlight['side']) =>
    context.markers
      .filter((marker) => {
        const a = left.get(marker.text) ?? 0,
          b = right.get(marker.text) ?? 0;
        if (issue.ruleId === 'tag-missing') return side === 'source' && b === 0;
        if (issue.ruleId === 'tag-extra') return side === 'target' && a === 0;
        if (issue.ruleId === 'tag-count') return a > 0 && b > 0 && a !== b;
        if (issue.ruleId === 'tag-structure') return /^[<❮❰]/u.test(marker.text);
        return issue.ruleId === 'tag-order';
      })
      .map(({ start, end }) => ({ start, end }));
  return {
    ...issue,
    highlights: [
      ...qaHighlight('source', source.text, ranges(source, 'source')),
      ...qaHighlight('target', target.text, ranges(target, 'target')),
    ],
  };
}

/** Convert raw token-content offsets to atomic editor markers without changing QA findings. */
export function withEditorHighlights(segment: Segment, issue: QaIssue): QaIssue {
  if (!issue.highlights?.length) return issue;
  const highlights = issue.highlights.flatMap((highlight) => {
    const tokens = highlight.side === 'source' ? segment.sourceTokens : segment.targetTokens;
    if (highlight.text !== qaText(tokens)) return [];
    const parts = serializeTokensToEditorParts(tokens, segment.sourceTokens);
    const editorText = parts.join('');
    const normalize = (text: string) => text.replace(/\r\n?/g, '\n');
    const ranges: QaTextRange[] = [];
    let rawOffset = 0,
      editorOffset = 0;
    tokens.forEach((token, index) => {
      for (const range of highlight.ranges) {
        const from = Math.max(range.start, rawOffset),
          to = Math.min(range.end, rawOffset + token.content.length);
        if (to <= from) continue;
        const start = editorOffset + (token.type === 'tag' ? 0 : from - rawOffset);
        const end = editorOffset + (token.type === 'tag' ? parts[index].length : to - rawOffset);
        ranges.push({
          start: normalize(editorText.slice(0, start)).length,
          end: normalize(editorText.slice(0, end)).length,
        });
      }
      rawOffset += token.content.length;
      editorOffset += parts[index].length;
    });
    return qaHighlight(highlight.side, normalize(editorText), ranges);
  });
  return { ...issue, highlights };
}
