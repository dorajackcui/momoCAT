import type { QaIssue, Segment, Token } from '../models';
import { QA_TAG_TYPES, type ProjectQASettings, type QaTagType } from '../project/qaSettings';
import { checkTagIntegrity } from './tagRules';
import { qaText, scanQaMarkers } from './text';
import { withTagHighlights } from './highlights';

export function checkDocumentTags(segment: Segment, settings: ProjectQASettings): QaIssue[] {
  const ignored = new Set(settings.options?.ignoredTags ?? []);
  const types = new Set(settings.options?.tagTypes ?? QA_TAG_TYPES);
  const markerType = (tag: string): QaTagType =>
    tag.startsWith('<')
      ? 'angle'
      : tag.startsWith('{')
        ? 'brace'
        : tag.startsWith('[')
          ? 'color'
          : tag === '|'
            ? 'pipe'
            : 'newline';
  const extract = (tokens: readonly Token[]) => {
    const text = qaText(tokens);
    const markers = scanQaMarkers(text);
    if (types.has('pipe') && !ignored.has('|')) {
      for (const match of text.matchAll(/\|/g)) {
        markers.push({ text: '|', start: match.index!, end: match.index! + 1 });
      }
      markers.sort((left, right) => left.start - right.start);
    }
    return {
      text,
      markers: markers.filter(
        (marker) => !ignored.has(marker.text) && types.has(markerType(marker.text)),
      ),
    };
  };
  const source = extract(segment.sourceTokens),
    target = extract(segment.targetTokens);
  return checkTagIntegrity(
    source.markers.map((marker) => marker.text),
    target.markers.map((marker) => marker.text),
  ).map((issue) => withTagHighlights(issue, source, target));
}
