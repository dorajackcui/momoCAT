import type { Segment } from '@cat/core/models';
import type { JobUnit } from '../../job/types';
import { mapTBEngineReferences } from '../../modules/TBModule';
import { mapTMEngineReferences } from '../../modules/TMModule';
import type { RequestModeReferenceModules, ResolvedReferences } from '../types';

export interface ResolveRequestModeReferencesInput {
  projectId: number;
  segment: Segment;
  tmModule: RequestModeReferenceModules['tmModule'];
  tbModule: RequestModeReferenceModules['tbModule'];
}

export type RequestModeReferenceResolver = (
  params: ResolveRequestModeReferencesInput,
) => Promise<ResolvedReferences>;

export const resolveRequestModeReferences: RequestModeReferenceResolver = async (params) => {
  const [tmMatches, tbMatches] = await Promise.all([
    params.tmModule.inspect(params.projectId, params.segment),
    params.tbModule.inspect(params.projectId, params.segment),
  ]);

  return {
    engineReferences: {
      tm: mapTMEngineReferences(tmMatches.rawMatches),
      tb: mapTBEngineReferences(tbMatches.rawMatches),
    },
    tm: tmMatches,
    tb: tbMatches,
  };
};

export function emptyReferencesForUnit(
  unit: Pick<JobUnit, 'unitId'>,
  segment: Segment,
): ResolvedReferences {
  return {
    engineReferences: {
      tm: [],
      tb: [],
    },
    tm: {
      unitId: unit.unitId,
      segmentId: segment.segmentId,
      mountedTMs: [],
      rawMatches: [],
      selectedReferences: {
        tmReferences: [],
        concordanceReferences: [],
      },
      selectionPolicy: {
        maxTmReferences: 0,
        maxConcordanceReferences: 0,
      },
      diagnostics: [],
    },
    tb: {
      unitId: unit.unitId,
      segmentId: segment.segmentId,
      mountedTBs: [],
      rawMatches: [],
      selectedReferences: [],
      selectionPolicy: {
        maxTbReferences: 0,
      },
      diagnostics: [],
    },
  };
}
