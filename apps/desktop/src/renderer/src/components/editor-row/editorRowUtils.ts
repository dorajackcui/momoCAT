interface DraftSyncDecisionInput {
  isDraftSyncSuspended: boolean;
  draftText: string;
  targetEditorText: string;
  isActive: boolean;
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

export type { DraftSyncDecisionInput };
