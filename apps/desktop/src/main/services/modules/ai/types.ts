import type { Segment, SegmentStatus, Token } from '@cat/core/models';
import type {
  DialoguePromptPreviousGroup,
  PromptTBReference,
  PromptTMReference,
} from '@cat/core/project';
import type { TBService } from '../../TBService';
import type { TMService } from '../../TMService';

export interface PromptReferenceResolvers {
  tmService?: Pick<TMService, 'findMatches'>;
  tbService?: Pick<TBService, 'findMatches'>;
}

export interface TranslationPromptReferences {
  tmReference?: PromptTMReference;
  tmReferences?: PromptTMReference[];
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
