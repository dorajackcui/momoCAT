import type { Segment } from '@cat/core/models';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { PromptReferenceResolvers, TranslationPromptReferences } from './types';

const MAX_TB_PROMPT_REFERENCES = 100;

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
      const bestMatch = tmMatches[0];
      if (bestMatch) {
        references.tmReference = {
          similarity: bestMatch.similarity,
          tmName: bestMatch.tmName,
          sourceText: serializeTokensToDisplayText(bestMatch.sourceTokens),
          targetText: serializeTokensToDisplayText(bestMatch.targetTokens),
        };
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
        references.tbReferences = tbMatches.slice(0, MAX_TB_PROMPT_REFERENCES).map((match) => ({
          srcTerm: match.srcTerm,
          tgtTerm: match.tgtTerm,
          note: match.note ?? null,
        }));
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
