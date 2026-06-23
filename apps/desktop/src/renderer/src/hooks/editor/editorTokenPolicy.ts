import type { Segment, Token } from '@cat/core/models';
import {
  parseEditorTextToTokens,
  serializeTokensToEditorText,
  type TagPolicy,
} from '@cat/core/tag';

export function normalizeEditorInputText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function parseTargetEditorText(
  text: string,
  sourceTokens: Token[],
  tagPolicy: TagPolicy,
): Token[] {
  return parseEditorTextToTokens(normalizeEditorInputText(text), sourceTokens, { tagPolicy });
}

export function shouldInsertTermSpacer(current: string, term: string): boolean {
  const left = current.slice(-1);
  const right = term.slice(0, 1);
  if (!left || !right) return false;
  return /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);
}

export function appendTermToTargetTokens(
  segment: Pick<Segment, 'sourceTokens' | 'targetTokens'>,
  term: string,
  tagPolicy: TagPolicy,
): Token[] {
  const currentText = normalizeEditorInputText(
    serializeTokensToEditorText(segment.targetTokens, segment.sourceTokens),
  );
  const insertsPlainTagLikeText =
    tagPolicy === 'none' && /[A-Za-z0-9]$/.test(currentText) && /^<[^>]+>/.test(term);
  const spacer = shouldInsertTermSpacer(currentText, term) || insertsPlainTagLikeText ? ' ' : '';
  return parseTargetEditorText(`${currentText}${spacer}${term}`, segment.sourceTokens, tagPolicy);
}
