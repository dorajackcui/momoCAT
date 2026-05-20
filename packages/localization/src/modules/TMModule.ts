import type { Segment } from '@cat/core/models';
import type { PromptConcordanceReference, PromptTMReference } from '@cat/core/project';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { TMRepository } from '../ports';
import { type TMMatch, type TMService } from '../internalServices';
import type { EngineTMReference } from '../types';
import type { MountedTMArtifact, TMArtifact } from '../artifacts';

export const MAX_TM_PROMPT_REFERENCES = 3;
export const MAX_CONCORDANCE_PROMPT_REFERENCES = 3;
export const MAX_ENGINE_TM_REFERENCES = 10;

export interface TMModuleOptions {
  tmRepo: Pick<TMRepository, 'getProjectMountedTMs'>;
  tmService: Pick<TMService, 'findMatches'>;
}

export class TMModule {
  private readonly tmRepo: Pick<TMRepository, 'getProjectMountedTMs'>;
  private readonly tmService: Pick<TMService, 'findMatches'>;

  constructor(options: TMModuleOptions);
  constructor(
    tmRepo: Pick<TMRepository, 'getProjectMountedTMs'>,
    tmService: Pick<TMService, 'findMatches'>,
  );
  constructor(
    optionsOrRepo: TMModuleOptions | Pick<TMRepository, 'getProjectMountedTMs'>,
    tmService?: Pick<TMService, 'findMatches'>,
  ) {
    if (tmService) {
      this.tmRepo = optionsOrRepo as Pick<TMRepository, 'getProjectMountedTMs'>;
      this.tmService = tmService;
      return;
    }

    const options = optionsOrRepo as TMModuleOptions;
    this.tmRepo = options.tmRepo;
    this.tmService = options.tmService;
  }

  async inspect(projectId: number, segment: Segment): Promise<TMArtifact> {
    const mountedTMs = this.tmRepo.getProjectMountedTMs(projectId).map(mapMountedTM);
    const rawMatches = await this.tmService.findMatches(projectId, segment);

    return {
      unitId: getSegmentUnitId(segment),
      segmentId: segment.segmentId,
      mountedTMs,
      rawMatches,
      selectedReferences: buildTMPromptReferences(rawMatches),
      selectionPolicy: {
        maxTmReferences: MAX_TM_PROMPT_REFERENCES,
        maxConcordanceReferences: MAX_CONCORDANCE_PROMPT_REFERENCES,
      },
      diagnostics: [],
    };
  }
}

function getSegmentUnitId(segment: Segment): string {
  const metadata = segment.meta as Segment['meta'] & { externalUnitId?: unknown };
  return String(metadata.externalUnitId ?? segment.segmentId);
}

export function mapTMEngineReferences(matches: TMMatch[]): EngineTMReference[] {
  return matches.slice(0, MAX_ENGINE_TM_REFERENCES).map((match) => {
    const base = {
      kind: match.kind,
      rank: match.rank,
      tmName: match.tmName,
      sourceText: serializeTokensToDisplayText(match.sourceTokens),
      targetText: serializeTokensToDisplayText(match.targetTokens),
    };

    if (match.kind === 'tm') {
      return {
        ...base,
        kind: 'tm',
        similarity: match.similarity,
      };
    }

    return {
      ...base,
      kind: 'concordance',
      matchedSourceText: match.matchedSourceText,
    };
  });
}

export function buildTMPromptReferences(matches: TMMatch[]): TMArtifact['selectedReferences'] {
  return {
    tmReferences: matches
      .filter((match): match is Extract<TMMatch, { kind: 'tm' }> => match.kind === 'tm')
      .slice(0, MAX_TM_PROMPT_REFERENCES)
      .map(mapTMPromptReference),
    concordanceReferences: matches
      .filter(
        (match): match is Extract<TMMatch, { kind: 'concordance' }> => match.kind === 'concordance',
      )
      .slice(0, MAX_CONCORDANCE_PROMPT_REFERENCES)
      .map(mapConcordancePromptReference),
  };
}

function mapTMPromptReference(match: Extract<TMMatch, { kind: 'tm' }>): PromptTMReference {
  return {
    similarity: match.similarity,
    tmName: match.tmName,
    sourceText: serializeTokensToDisplayText(match.sourceTokens),
    targetText: serializeTokensToDisplayText(match.targetTokens),
  };
}

function mapConcordancePromptReference(
  match: Extract<TMMatch, { kind: 'concordance' }>,
): PromptConcordanceReference {
  return {
    tmName: match.tmName,
    matchedSourceText: match.matchedSourceText,
    sourceText: serializeTokensToDisplayText(match.sourceTokens),
    targetText: serializeTokensToDisplayText(match.targetTokens),
  };
}

function mapMountedTM(
  tm: ReturnType<TMRepository['getProjectMountedTMs']>[number],
): MountedTMArtifact {
  return {
    id: tm.id,
    name: tm.name,
    srcLang: tm.srcLang,
    tgtLang: tm.tgtLang,
    type: tm.type,
    priority: tm.priority,
    permission: tm.permission,
    isEnabled: Boolean(tm.isEnabled),
  };
}
