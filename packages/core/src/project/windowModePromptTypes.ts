import type {
  PromptConcordanceReference,
  PromptTBReference,
  PromptTMReference,
} from "./aiPromptTypes";

export type WindowModeProjectType = "translation" | "review" | "custom";

export type WindowModeRequestMode = "window" | "window-partial";

export interface WindowModeCurrentSegment {
  id: string;
  sourcePayload: string;
  context?: string;
  tmReferences?: PromptTMReference[];
  concordanceReferences?: PromptConcordanceReference[];
  tbReferences?: PromptTBReference[];
}

export interface WindowModePreviousContextRow {
  source: string;
  target: string;
}

export interface WindowModeNextContextRow {
  source: string;
}

export interface WindowModeReadOnlyContextRow {
  role: "previous" | "current-existing" | "next";
  source: string;
  target?: string;
  rowNumber?: number;
}

export interface WindowModePromptBundleBuildParams {
  projectType?: WindowModeProjectType;
  srcLang: string;
  tgtLang: string;
  projectPrompt?: string;
  requestMode?: WindowModeRequestMode;
  currentSegments: WindowModeCurrentSegment[];
  previousContext?: WindowModePreviousContextRow[];
  nextContext?: WindowModeNextContextRow[];
  readOnlyContextRows?: WindowModeReadOnlyContextRow[];
  validationFeedback?: string;
}

export interface WindowModePromptSections {
  batchBlock: string;
  currentSegmentsBlock: string;
  tmPromptBlock: string;
  concordancePromptBlock: string;
  tbPromptBlock: string;
  referencePromptBlock: string;
  previousContextBlock: string;
  nextContextBlock: string;
  validationFeedbackBlock: string;
  jsonFormatBlock: string;
}

export interface WindowModePromptBundle {
  systemPrompt: string;
  userPrompt: string;
  sections: WindowModePromptSections;
}

export interface WindowModeParsedTranslation {
  id: string;
  text: string;
}
