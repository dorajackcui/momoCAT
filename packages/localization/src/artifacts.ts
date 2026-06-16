import type {
  PromptConcordanceReference,
  PromptTBReference,
  PromptTMReference,
  ProjectType,
} from '@cat/core/project';
import type { TBMatch, TMEntry } from '@cat/core/models';
import type { ReasoningEffort } from './ports';

type TMMatchBase = TMEntry & {
  kind: 'tm' | 'concordance';
  rank: number;
  tmName: string;
  tmType: 'working' | 'main';
};

type TMMatch =
  | (TMMatchBase & {
      kind: 'tm';
      similarity: number;
    })
  | (TMMatchBase & {
      kind: 'concordance';
      matchedSourceText: string;
      sourceCoverage: number;
      entryCoverage: number;
    });

export type InspectUnitStatus = 'ready' | 'skipped-empty-source' | 'error';

export interface FileParseColumnsArtifact {
  sourceCol: number;
  targetCol: number;
  contextCol?: number;
  hasHeader: boolean;
}

export type FileCellValue = string | number | boolean | null;

export interface FileParseRowArtifact {
  rowIndex: number;
  rowNumber: number;
  unitId: string;
  source: string;
  target: string;
  context?: string;
  originalCells: FileCellValue[];
}

export interface FileParseArtifact {
  inputPath: string;
  sheetName: string;
  columns: FileParseColumnsArtifact;
  rows: FileParseRowArtifact[];
}

export interface MountedTMArtifact {
  id: string;
  name: string;
  srcLang: string;
  tgtLang: string;
  type: string;
  priority: number;
  permission: string;
  isEnabled: boolean;
}

export interface TMArtifact {
  unitId: string;
  segmentId: string;
  mountedTMs: MountedTMArtifact[];
  rawMatches: TMMatch[];
  selectedReferences: {
    tmReferences: PromptTMReference[];
    concordanceReferences: PromptConcordanceReference[];
  };
  selectionPolicy: {
    maxTmReferences: number;
    maxConcordanceReferences: number;
  };
  diagnostics: string[];
}

export interface MountedTBArtifact {
  id: string;
  name: string;
  srcLang: string;
  tgtLang: string;
  priority: number;
  isEnabled: boolean;
}

export interface TBArtifact {
  unitId: string;
  segmentId: string;
  mountedTBs: MountedTBArtifact[];
  rawMatches: TBMatch[];
  selectedReferences: PromptTBReference[];
  selectionPolicy: {
    maxTbReferences: number;
  };
  diagnostics: string[];
}

export interface PromptProviderArtifact {
  id: string | null;
  name: string | null;
  baseUrl: string | null;
}

export interface PromptBatchArtifact {
  mode: 'window' | 'window-partial';
  taskId: string;
  currentIds: string[];
  responseIdMap?: Array<{
    responseId: string;
    documentId: string;
    unitId: string;
  }>;
  previousContextCount: number;
  nextContextCount: number;
  scanWindowCount?: number;
  requestCount?: number;
  readOnlyContextCount?: number;
}

export interface PromptArtifact {
  unitId: string;
  provider: PromptProviderArtifact;
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  projectPrompt: string;
  projectType: ProjectType;
  sourcePayload: string;
  tmPromptBlock: string;
  concordancePromptBlock: string;
  tbPromptBlock: string;
  referencePromptBlock: string;
  systemPrompt: string;
  userPrompt: string;
  promptChars: {
    system: number;
    user: number;
    total: number;
  };
  batch?: PromptBatchArtifact;
}

export interface InspectTruncatedFields {
  tmForMt: boolean;
  tbForMt: boolean;
  mtUserPrompt: boolean;
}

export interface InspectUnitArtifact {
  unit: FileParseRowArtifact;
  transientSegment: {
    segmentId: string;
    matchKey: string;
    srcHash: string;
    tagsSignature: string;
  };
  tm: TMArtifact;
  tb: TBArtifact;
  mt: PromptArtifact;
  xlsx: {
    tmForMt: string;
    tbForMt: string;
    mtUserPrompt: string;
    truncated: InspectTruncatedFields;
  };
  status: InspectUnitStatus;
  error?: string;
}

export interface InspectArtifact {
  version: 1;
  generatedAt: string;
  project: {
    id: number;
    name: string;
    srcLang: string;
    tgtLang: string;
    projectType: ProjectType;
    promptChars: number;
  };
  inputFile: FileParseArtifact;
  systemPrompt: {
    value: string;
    promptChars: number;
    xlsxValue: string;
    truncated: boolean;
  };
  units: InspectUnitArtifact[];
}
