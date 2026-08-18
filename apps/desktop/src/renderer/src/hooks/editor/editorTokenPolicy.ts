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

interface TargetEditorSelectionController {
  getSnapshot: () => {
    text: string;
    selectionFrom: number;
    selectionTo: number;
  } | null;
  replaceSelection: (insertText: string) => void;
}

function shouldInsertPlainTagSpacer(leftText: string, rightText: string): boolean {
  return (
    (/[A-Za-z0-9]$/.test(leftText) && /^<[^>]+>/.test(rightText)) ||
    (/<[^>]+>$/.test(leftText) && /^[A-Za-z0-9]/.test(rightText))
  );
}

export function buildTermInsertionText(
  currentText: string,
  selectionFrom: number,
  selectionTo: number,
  term: string,
  tagPolicy: TagPolicy,
): string {
  const from = Math.max(0, Math.min(selectionFrom, selectionTo, currentText.length));
  const to = Math.max(from, Math.min(Math.max(selectionFrom, selectionTo), currentText.length));
  const beforeSelection = currentText.slice(0, from);
  const afterSelection = currentText.slice(to);
  const insertLeftSpacer =
    shouldInsertTermSpacer(beforeSelection, term) ||
    (tagPolicy === 'none' && shouldInsertPlainTagSpacer(beforeSelection, term));
  const insertRightSpacer =
    shouldInsertTermSpacer(term, afterSelection) ||
    (tagPolicy === 'none' && shouldInsertPlainTagSpacer(term, afterSelection));

  return `${insertLeftSpacer ? ' ' : ''}${term}${insertRightSpacer ? ' ' : ''}`;
}

export function applyTermAtEditorSelection(
  controller: TargetEditorSelectionController,
  term: string,
  tagPolicy: TagPolicy,
): boolean {
  const snapshot = controller.getSnapshot();
  if (!snapshot) return false;

  controller.replaceSelection(
    buildTermInsertionText(
      snapshot.text,
      snapshot.selectionFrom,
      snapshot.selectionTo,
      term,
      tagPolicy,
    ),
  );
  return true;
}

export function appendTermToTargetTokens(
  segment: Pick<Segment, 'sourceTokens' | 'targetTokens'>,
  term: string,
  tagPolicy: TagPolicy,
): Token[] {
  const currentText = normalizeEditorInputText(
    serializeTokensToEditorText(segment.targetTokens, segment.sourceTokens),
  );
  const insertionText = buildTermInsertionText(
    currentText,
    currentText.length,
    currentText.length,
    term,
    tagPolicy,
  );
  return parseTargetEditorText(`${currentText}${insertionText}`, segment.sourceTokens, tagPolicy);
}
