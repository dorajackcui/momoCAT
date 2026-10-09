import type { QaIssue, Token } from '../models';
import { isActualLineBreakTagContent } from '../tag/signature';
import { checkTagIntegrity } from './tagRules';
import { withTagHighlights, type QaMarkerContext } from './highlights';
import { qaText } from './text';

/** Fixed token checks within QA, independent of optional project checks. */
export function checkProtectedTokens(
  source: readonly Token[],
  target: readonly Token[],
  tagPolicy: 'default' | 'none' = 'default',
): QaIssue[] {
  if (tagPolicy === 'none') return [];
  const collect = (tokens: readonly Token[]): QaMarkerContext => {
    let offset = 0;
    const markers = tokens.flatMap((token) => {
      const start = offset;
      offset += token.content.length;
      return token.type === 'tag' && !isActualLineBreakTagContent(token.content)
        ? [{ text: token.content, start, end: offset }]
        : [];
    });
    return { text: qaText(tokens), markers };
  };
  const left = collect(source),
    right = collect(target);
  return checkTagIntegrity(
    left.markers.map((marker) => marker.text),
    right.markers.map((marker) => marker.text),
  )
    .filter((issue) => issue.ruleId !== 'tag-order')
    .map((issue) => withTagHighlights(issue, left, right));
}
