import type { QaIssue, Segment, Token } from '../models';
import { QA_TAG_TYPES, type ProjectQASettings, type QaTagType } from '../project/qaSettings';
import { checkTagIntegrity } from './tagRules';
import { qaText, scanQaMarkers } from './text';

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
          : 'newline';
  const extract = (tokens: readonly Token[]) =>
    scanQaMarkers(qaText(tokens))
      .map((marker) => marker.text)
      .filter((tag) => !ignored.has(tag) && types.has(markerType(tag)));
  return checkTagIntegrity(extract(segment.sourceTokens), extract(segment.targetTokens));
}
