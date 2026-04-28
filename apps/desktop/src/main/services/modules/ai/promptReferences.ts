import type { Segment } from '@cat/core/models';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { PromptReferenceResolvers, TranslationPromptReferences } from './types';

const MAX_TM_PROMPT_REFERENCES = 3;
const MAX_CONCORDANCE_PROMPT_REFERENCES = 3;
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
      const standardTmMatches = tmMatches.filter((match) => match.kind === 'tm');
      const concordanceMatches = tmMatches.filter((match) => match.kind === 'concordance');

      if (standardTmMatches.length > 0) {
        references.tmReferences = standardTmMatches
          .slice(0, MAX_TM_PROMPT_REFERENCES)
          .map((match) => ({
            similarity: match.similarity,
            tmName: match.tmName,
            sourceText: serializeTokensToDisplayText(match.sourceTokens),
            targetText: serializeTokensToDisplayText(match.targetTokens),
          }));
        references.tmReference = references.tmReferences[0];
      }

      if (concordanceMatches.length > 0) {
        references.concordanceReferences = concordanceMatches
          .slice(0, MAX_CONCORDANCE_PROMPT_REFERENCES)
          .map((match) => ({
            tmName: match.tmName,
            matchedSourceText: match.matchedSourceText,
            sourceText: serializeTokensToDisplayText(match.sourceTokens),
            targetText: serializeTokensToDisplayText(match.targetTokens),
          }));
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
