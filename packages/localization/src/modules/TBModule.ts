import type { Segment, TBMatch } from '@cat/core/models';
import type { PromptTBReference } from '@cat/core/project';
import type { TBRepository } from '../ports';
import type { TBService } from '../services/TBService';
import type { MountedTBArtifact, TBArtifact } from '../artifacts';
import type { EngineTBReference } from '../types';

export const MAX_TB_PROMPT_REFERENCES = 100;
export const MAX_ENGINE_TB_REFERENCES = 100;

export interface TBModuleOptions {
  tbRepo: Pick<TBRepository, 'getProjectMountedTermBases'>;
  tbService: Pick<TBService, 'findMatches'>;
}

export class TBModule {
  private readonly tbRepo: Pick<TBRepository, 'getProjectMountedTermBases'>;
  private readonly tbService: Pick<TBService, 'findMatches'>;

  constructor(options: TBModuleOptions);
  constructor(
    tbRepo: Pick<TBRepository, 'getProjectMountedTermBases'>,
    tbService: Pick<TBService, 'findMatches'>,
  );
  constructor(
    optionsOrRepo: TBModuleOptions | Pick<TBRepository, 'getProjectMountedTermBases'>,
    tbService?: Pick<TBService, 'findMatches'>,
  ) {
    if (tbService) {
      this.tbRepo = optionsOrRepo as Pick<TBRepository, 'getProjectMountedTermBases'>;
      this.tbService = tbService;
      return;
    }

    const options = optionsOrRepo as TBModuleOptions;
    this.tbRepo = options.tbRepo;
    this.tbService = options.tbService;
  }

  async inspect(projectId: number, segment: Segment): Promise<TBArtifact> {
    const mountedTBs = this.tbRepo.getProjectMountedTermBases(projectId).map(mapMountedTB);
    const rawMatches = await this.tbService.findMatches(projectId, segment);

    return {
      unitId: getSegmentUnitId(segment),
      segmentId: segment.segmentId,
      mountedTBs,
      rawMatches,
      selectedReferences: buildTBPromptReferences(rawMatches),
      selectionPolicy: {
        maxTbReferences: MAX_TB_PROMPT_REFERENCES,
      },
      diagnostics: [],
    };
  }
}

function getSegmentUnitId(segment: Segment): string {
  const metadata = segment.meta as Segment['meta'] & { externalUnitId?: unknown };
  return String(metadata.externalUnitId ?? segment.segmentId);
}

export function mapTBEngineReferences(matches: TBMatch[]): EngineTBReference[] {
  return matches.slice(0, MAX_ENGINE_TB_REFERENCES).map((match) => ({
    tbName: match.tbName,
    srcTerm: match.srcTerm,
    tgtTerm: match.tgtTerm,
    note: match.note ?? null,
  }));
}

export function buildTBPromptReferences(matches: TBMatch[]): PromptTBReference[] {
  return matches.slice(0, MAX_TB_PROMPT_REFERENCES).map((match) => ({
    srcTerm: match.srcTerm,
    tgtTerm: match.tgtTerm,
    note: match.note ?? null,
  }));
}

function mapMountedTB(
  tb: ReturnType<TBRepository['getProjectMountedTermBases']>[number],
): MountedTBArtifact {
  return {
    id: tb.id,
    name: tb.name,
    srcLang: tb.srcLang,
    tgtLang: tb.tgtLang,
    priority: tb.priority,
    isEnabled: Boolean(tb.isEnabled),
  };
}
