import type { Segment, SegmentStatus, Token } from '@cat/core/models';
import type { TBService } from '../../TBService';
import type { TMService } from '../../TMService';
import type {
  DialoguePromptPreviousGroup,
  PromptTBReference,
  PromptTMReference,
} from '../ai-prompts/types';

export interface PromptReferenceResolvers {
  tmService?: Pick<TMService, 'findMatches'>;
  tbService?: Pick<TBService, 'findMatches'>;
}

export interface TranslationPromptReferences {
  tmReference?: PromptTMReference;
  tbReferences?: PromptTBReference[];
}

export interface DialogueSegmentDraft {
  segment: Segment;
  speaker: string;
  speakerKey: string;
  sourceText: string;
  sourcePayload: string;
}

export interface DialogueTranslationUnit {
  speaker: string;
  speakerKey: string;
  charCount: number;
  segments: DialogueSegmentDraft[];
}

export interface SegmentUpdateDraft {
  segmentId: string;
  targetTokens: Token[];
  status: SegmentStatus;
}

export interface DialogueTranslationResult {
  updates: SegmentUpdateDraft[];
  previousGroup: DialoguePromptPreviousGroup;
}
