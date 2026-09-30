import type {
  PromptConcordanceReference,
  PromptTBReference,
  PromptTMReference,
} from '@cat/core/project';
import type { TBService } from '../services/TBService';
import type { TMService } from '../services/TMService';

export interface PromptReferenceResolvers {
  tmService?: Pick<TMService, 'findMatches'>;
  tbService?: Pick<TBService, 'findMatches'>;
}

export interface TranslationPromptReferences {
  tmReference?: PromptTMReference;
  tmReferences?: PromptTMReference[];
  concordanceReferences?: PromptConcordanceReference[];
  tbReferences?: PromptTBReference[];
}

import type { Segment } from '@cat/core/models';
import { buildTMPromptReferences } from './TMModule';
import { buildTBPromptReferences } from './TBModule';

interface ResolveTranslationPromptReferencesParams {
  projectId: number;
  segment: Segment;
  resolvers: PromptReferenceResolvers;
}

export async function resolveTranslationPromptReferences(
  params: ResolveTranslationPromptReferencesParams,
): Promise<TranslationPromptReferences> {
  const references: TranslationPromptReferences = {};

  if (params.resolvers.tmService) {
    try {
      const tmMatches = await params.resolvers.tmService.findMatches(
        params.projectId,
        params.segment,
      );
      const selectedReferences = buildTMPromptReferences(tmMatches);

      if (selectedReferences.tmReferences.length > 0) {
        references.tmReferences = selectedReferences.tmReferences;
        references.tmReference = selectedReferences.tmReferences[0];
      }

      if (selectedReferences.concordanceReferences.length > 0) {
        references.concordanceReferences = selectedReferences.concordanceReferences;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[AIModule] Failed to resolve TM reference for segment ${params.segment.segmentId}: ${message}`,
      );
    }
  }

  if (params.resolvers.tbService) {
    try {
      const tbMatches = await params.resolvers.tbService.findMatches(
        params.projectId,
        params.segment,
      );
      if (tbMatches.length > 0) {
        references.tbReferences = buildTBPromptReferences(tbMatches);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[AIModule] Failed to resolve TB references for segment ${params.segment.segmentId}: ${message}`,
      );
    }
  }

  return references;
}
