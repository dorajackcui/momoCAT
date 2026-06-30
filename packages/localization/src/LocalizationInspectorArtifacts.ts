import type { Segment } from '@cat/core/models';
import type { Project, ProjectType } from '@cat/core/project';
import type {
  FileParseRowArtifact,
  InspectUnitArtifact,
  PromptArtifact,
  TBArtifact,
  TMArtifact,
} from './artifacts';

export function buildUnitXlsxFields({
  mt,
  unit,
  unitIndex,
  maxCellChars,
}: {
  mt: PromptArtifact;
  unit: Pick<InspectUnitArtifact, 'tm' | 'tb'>;
  unitIndex: number;
  maxCellChars: number;
}): InspectUnitArtifact['xlsx'] {
  const references = buildReferenceXlsxFields({
    unit,
    unitIndex,
    maxCellChars,
  });
  const mtUserPrompt = truncateForCell(
    mt.userPrompt,
    maxCellChars,
    `#/units/${unitIndex}/mt/userPrompt`,
  );

  return {
    tmForMt: references.tmForMt,
    tbForMt: references.tbForMt,
    mtUserPrompt: mtUserPrompt.value,
    truncated: {
      tmForMt: references.truncated.tmForMt,
      tbForMt: references.truncated.tbForMt,
      mtUserPrompt: mtUserPrompt.truncated,
    },
  };
}

export function buildReferenceXlsxFields({
  unit,
  unitIndex,
  maxCellChars,
}: {
  unit: Pick<InspectUnitArtifact, 'tm' | 'tb'>;
  unitIndex: number;
  maxCellChars: number;
}): Pick<InspectUnitArtifact['xlsx'], 'tmForMt' | 'tbForMt'> & {
  truncated: Pick<InspectUnitArtifact['xlsx']['truncated'], 'tmForMt' | 'tbForMt'>;
} {
  const tmPromptInput = buildUnitTMForMt(unit.tm);
  const tbPromptInput = buildUnitTBForMt(unit.tb);
  const tmForMt = truncateForCell(
    tmPromptInput,
    maxCellChars,
    `#/units/${unitIndex}/tm/selectedReferences`,
  );
  const tbForMt = truncateForCell(
    tbPromptInput,
    maxCellChars,
    `#/units/${unitIndex}/tb/selectedReferences`,
  );

  return {
    tmForMt: tmForMt.value,
    tbForMt: tbForMt.value,
    truncated: {
      tmForMt: tmForMt.truncated,
      tbForMt: tbForMt.truncated,
    },
  };
}

function buildUnitTMForMt(tm: TMArtifact): string {
  return [
    buildUnitTMReferenceBlock(tm.selectedReferences.tmReferences),
    buildUnitConcordanceReferenceBlock(
      tm.selectedReferences.concordanceReferences,
    ),
  ]
    .filter((block) => block.length > 0)
    .join('\n\n');
}

function buildUnitTMReferenceBlock(
  references: TMArtifact['selectedReferences']['tmReferences'],
): string {
  if (references.length === 0) {
    return '';
  }

  return [
    'TM References',
    ...references.map(
      (reference, index) =>
        `${index + 1}. ${reference.similarity}% ${reference.tmName} | ${reference.sourceText} -> ${reference.targetText}`,
    ),
  ].join('\n');
}

function buildUnitConcordanceReferenceBlock(
  references: TMArtifact['selectedReferences']['concordanceReferences'],
): string {
  if (references.length === 0) {
    return '';
  }

  return [
    'Concordance Suggestions',
    ...references.map(
      (reference, index) =>
        `${index + 1}. ${reference.matchedSourceText} (${reference.tmName}) | ${reference.sourceText} -> ${reference.targetText}`,
    ),
  ].join('\n');
}

function buildUnitTBForMt(tb: TBArtifact): string {
  if (tb.selectedReferences.length === 0) {
    return '';
  }

  return [
    'Terminology References',
    ...tb.selectedReferences.map((reference, index) => {
      const note =
        typeof reference.note === 'string' ? reference.note.trim() : '';
      const noteSuffix = note ? ` (note: ${note})` : '';
      return `${index + 1}. ${reference.srcTerm} -> ${reference.tgtTerm}${noteSuffix}`;
    }),
  ].join('\n');
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
