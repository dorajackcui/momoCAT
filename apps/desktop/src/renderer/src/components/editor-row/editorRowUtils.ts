interface DraftSyncDecisionInput {
  isDraftSyncSuspended: boolean;
  draftText: string;
  targetEditorText: string;
  isActive: boolean;
}

interface NonPrintingVisualizationOptions {
  showLineBreakSymbol?: boolean;
}

export function hasRefinableTargetText(text: string): boolean {
  return text.trim().length > 0;
}

export function normalizeRefinementInstruction(instruction: string): string {
  return instruction.trim();
}

export function shouldSyncDraftFromExternalTarget({
  isDraftSyncSuspended,
  draftText,
  targetEditorText,
  isActive,
}: DraftSyncDecisionInput): boolean {
  // Keep blur-flush protection only after row becomes inactive.
  // This lets TM/TB side-panel apply updates reflect immediately on the active row.
  if (isDraftSyncSuspended && !isActive) return false;
  if (draftText === targetEditorText) return false;
  return true;
}

export function visualizeNonPrintingSymbols(
  text: string,
  options: NonPrintingVisualizationOptions = {},
): string {
  const { showLineBreakSymbol = true } = options;
  let visualized = text
    .replace(/\u202F/g, '⎵')
    .replace(/\u00A0/g, '⍽')
    .replace(/ /g, '·')
    .replace(/\t/g, '⇥');
  if (showLineBreakSymbol) {
    visualized = visualized.replace(/\n/g, '↵\n');
  }
  return visualized;
}

export function parseVisualizedNonPrintingSymbols(text: string): string {
  let result = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '·') {
      result += ' ';
      continue;
    }
    if (char === '⍽') {
      result += '\u00A0';
      continue;
    }
    if (char === '⎵') {
      result += '\u202F';
      continue;
    }
    if (char === '⇥') {
      result += '\t';
      continue;
    }
    if (char === '↵' && next === '\n') {
      continue;
    }
    result += char;
  }
  return result;
}

export type { DraftSyncDecisionInput, NonPrintingVisualizationOptions };
