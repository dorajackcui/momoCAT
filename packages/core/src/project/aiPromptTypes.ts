export interface SystemPromptBuildParams {
  srcLang: string;
  tgtLang: string;
  projectPrompt?: string;
}

export interface PromptTMReference {
  similarity: number;
  tmName: string;
  sourceText: string;
  targetText: string;
}

export interface PromptTBReference {
  srcTerm: string;
  tgtTerm: string;
  note?: string | null;
}

export interface UserPromptBuildParams {
  srcLang: string;
  sourcePayload: string;
  hasProtectedMarkers: boolean;
  context?: string;
  currentTranslationPayload?: string;
  refinementInstruction?: string;
  validationFeedback?: string;
  tmReference?: PromptTMReference;
  tbReferences?: PromptTBReference[];
}

export interface DialoguePromptSegment {
  id: string;
  speaker: string;
  sourcePayload: string;
  tmReference?: PromptTMReference;
  tbReferences?: PromptTBReference[];
}

export interface DialoguePromptPreviousGroup {
  speaker: string;
  sourceText: string;
  targetText: string;
}

export interface DialogueUserPromptBuildParams {
  srcLang: string;
  tgtLang: string;
  segments: DialoguePromptSegment[];
  previousGroup?: DialoguePromptPreviousGroup;
  validationFeedback?: string;
}
