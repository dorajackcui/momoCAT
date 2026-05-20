import type { Segment } from '@cat/core/models';
import type { Project, ProjectType } from '@cat/core/project';
import type {
  FileParseRowArtifact,
  InspectUnitArtifact,
  PromptArtifact,
  TBArtifact,
  TMArtifact,
} from './artifacts';

export function buildXlsxFields(
  mt: PromptArtifact,
  unitIndex: number,
  maxCellChars: number,
): InspectUnitArtifact['xlsx'] {
  const tmPromptInput = [mt.tmPromptBlock, mt.concordancePromptBlock]
    .filter((block) => block.length > 0)
    .join('\n\n');
  const tmForMt = truncateForCell(
    tmPromptInput,
    maxCellChars,
    `#/units/${unitIndex}/mt/userPrompt`,
  );
  const tbForMt = truncateForCell(
    mt.tbPromptBlock,
    maxCellChars,
    `#/units/${unitIndex}/mt/tbPromptBlock`,
  );
  const mtUserPrompt = truncateForCell(
    mt.userPrompt,
    maxCellChars,
    `#/units/${unitIndex}/mt/userPrompt`,
  );

  return {
    tmForMt: tmForMt.value,
    tbForMt: tbForMt.value,
    mtUserPrompt: mtUserPrompt.value,
    truncated: {
      tmForMt: tmForMt.truncated,
      tbForMt: tbForMt.truncated,
      mtUserPrompt: mtUserPrompt.truncated,
    },
  };
}

export function emptyXlsxFields(): InspectUnitArtifact['xlsx'] {
  return {
    tmForMt: '',
    tbForMt: '',
    mtUserPrompt: '',
    truncated: {
      tmForMt: false,
      tbForMt: false,
      mtUserPrompt: false,
    },
  };
}

export function truncateForCell(
  value: string,
  maxCellChars: number,
  jsonRef: string,
): {
  value: string;
  truncated: boolean;
} {
  if (value.length <= maxCellChars) {
    return { value, truncated: false };
  }

  const marker = `[TRUNCATED: see ${jsonRef}]`;
  return {
    value:
      marker.length <= maxCellChars ? marker : marker.slice(0, maxCellChars),
    truncated: true,
  };
}

export function stageError<T>(
  stage: string,
  result: PromiseSettledResult<T>,
): string | undefined {
  if (result.status === 'fulfilled') {
    return undefined;
  }

  return `${stage}: ${errorMessage(result.reason)}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildErrorUnit(params: {
  row: FileParseRowArtifact;
  segment: Segment;
  project: Pick<Project, 'projectType'>;
  tm: TMArtifact;
  tb: TBArtifact;
  error: string;
}): InspectUnitArtifact {
  return {
    unit: params.row,
    transientSegment: segmentMetadata(params.segment),
    tm: params.tm,
    tb: params.tb,
    mt: emptyPromptArtifact(params.row.unitId, params.project),
    xlsx: emptyXlsxFields(),
    status: 'error',
    error: params.error,
  };
}

export function segmentMetadata(
  segment: Segment,
): InspectUnitArtifact['transientSegment'] {
  return {
    segmentId: segment.segmentId,
    matchKey: segment.matchKey,
    srcHash: segment.srcHash,
    tagsSignature: segment.tagsSignature,
  };
}

export function emptyTMArtifact(unitId: string, segmentId: string): TMArtifact {
  return {
    unitId,
    segmentId,
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
  };
}

export function emptyTBArtifact(unitId: string, segmentId: string): TBArtifact {
  return {
    unitId,
    segmentId,
    mountedTBs: [],
    rawMatches: [],
    selectedReferences: [],
    selectionPolicy: {
      maxTbReferences: 0,
    },
    diagnostics: [],
  };
}

export function emptyPromptArtifact(
  unitId: string,
  project: Pick<Project, 'projectType'>,
): PromptArtifact {
  return {
    unitId,
    provider: {
      id: null,
      name: null,
      baseUrl: null,
    },
    model: null,
    reasoningEffort: null,
    projectPrompt: '',
    projectType: (project.projectType ?? 'translation') as ProjectType,
    sourcePayload: '',
    tmPromptBlock: '',
    concordancePromptBlock: '',
    tbPromptBlock: '',
    referencePromptBlock: '',
    systemPrompt: '',
    userPrompt: '',
    promptChars: {
      system: 0,
      user: 0,
      total: 0,
    },
  };
}
