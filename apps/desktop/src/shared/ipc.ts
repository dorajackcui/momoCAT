import type { Segment, SegmentStatus, TBMatch, TMEntry, Token } from '@cat/core/models';
import type {
  FileQaReport,
  Project,
  ProjectAIModel as CoreProjectAIModel,
  ProjectQASettings,
  ProjectType as CoreProjectType,
} from '@cat/core/project';
import type {
  MountedTBRecord as DbMountedTBRecord,
  MountedTMRecord as DbMountedTMRecord,
  ProjectFileRecord as DbProjectFileRecord,
  TBRecord as DbTBRecord,
  TMRecord as DbTMRecord,
  TMType as DbTMType,
} from '../../../../packages/db/src/types';

export type TMType = DbTMType;
export type ProjectType = CoreProjectType;
export type ProjectAIModel = CoreProjectAIModel;

export interface ImportOptions {
  hasHeader: boolean;
  sourceCol: number;
  targetCol: number;
  contextCol?: number;
}

export interface TMImportOptions {
  sourceCol: number;
  targetCol: number;
  hasHeader: boolean;
  overwrite: boolean;
}

export interface TBImportOptions {
  sourceCol: number;
  targetCol: number;
  noteCol?: number;
  hasHeader: boolean;
  overwrite: boolean;
}

export type SpreadsheetPreviewCell = string | number | boolean | null | undefined;
export type SpreadsheetPreviewData = SpreadsheetPreviewCell[][];

export type ProjectWithStats = Project & {
  progress: number;
  fileCount: number;
};

export type ProjectFileRecord = DbProjectFileRecord;

export type TMRecord = DbTMRecord;

export interface TMWithStats extends TMRecord {
  stats: { entryCount: number };
}

export type MountedTM = DbMountedTMRecord & {
  entryCount: number;
};

export type TBRecord = DbTBRecord;

export interface TBWithStats extends TBRecord {
  stats: { entryCount: number };
}

export type MountedTB = DbMountedTBRecord & {
  stats: { entryCount: number };
};

export interface TMMatch extends TMEntry {
  similarity: number;
  tmName: string;
  tmType: TMType;
}

export interface TMConcordanceEntry extends TMEntry {
  tmId: string;
  tmName: string;
  tmType: TMType;
}

export interface SegmentUpdateResult {
  propagatedIds: string[];
  clientRequestId?: string;
  serverAppliedAt: string;
}

export interface TMBatchMatchResult {
  total: number;
  matched: number;
  applied: number;
  skipped: number;
}

export interface ImportExecutionResult {
  success: number;
  skipped: number;
}

export interface ImportJobResult extends ImportExecutionResult {
  kind: 'tm-import' | 'tb-import';
}

export interface StructuredJobError {
  code: string;
  message: string;
  details?: string;
}

export interface AISettings {
  apiKeySet: boolean;
  apiKeyLast4?: string;
}

export type ProxyMode = 'off' | 'system' | 'custom';

export interface ProxySettings {
  mode: ProxyMode;
  customProxyUrl: string;
  effectiveProxyUrl?: string;
}

export interface ProxySettingsInput {
  mode: ProxyMode;
  customProxyUrl?: string;
}

export interface AITestTranslateResult {
  ok: boolean;
  error?: string;
  promptUsed: string;
  userMessage: string;
  translatedText: string;
  requestId?: string;
  status?: number;
  endpoint?: string;
  model?: string;
  rawResponseText?: string;
  responseContent?: string;
}

export interface AISegmentTranslateResult {
  segmentId: string;
  status: SegmentStatus;
}

export type AIBatchMode = 'default' | 'dialogue';
export type AIBatchTargetScope = 'blank-only' | 'overwrite-non-confirmed';

export interface AITranslateFileOptions {
  mode?: AIBatchMode;
  targetScope?: AIBatchTargetScope;
}

export interface SegmentsUpdatedEvent {
  segmentId: string;
  targetTokens: Token[];
  status: SegmentStatus;
  propagatedIds: string[];
  clientRequestId?: string;
  serverAppliedAt: string;
}

export interface AppProgressEvent {
  type: string;
  current: number;
  total: number;
  message?: string;
}

export interface JobProgressEvent {
  jobId: string;
  progress: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  message?: string;
  result?: ImportJobResult;
  error?: StructuredJobError;
}

export interface DialogFileFilter {
  name: string;
  extensions: string[];
}

export interface DesktopApi {
  listProjects: () => Promise<ProjectWithStats[]>;
  createProject: (
    name: string,
    srcLang: string,
    tgtLang: string,
    projectType?: ProjectType,
  ) => Promise<Project>;
  deleteProject: (projectId: number) => Promise<void>;
  getProject: (projectId: number) => Promise<Project | undefined>;
  updateProjectPrompt: (projectId: number, aiPrompt: string | null) => Promise<void>;
  updateProjectAISettings: (
    projectId: number,
    aiPrompt: string | null,
    aiModel: ProjectAIModel | null,
  ) => Promise<void>;
  updateProjectQASettings: (projectId: number, qaSettings: ProjectQASettings) => Promise<void>;
  getProjectFiles: (projectId: number) => Promise<ProjectFileRecord[]>;
  getFile: (fileId: number) => Promise<ProjectFileRecord | undefined>;
  getFilePreview: (filePath: string) => Promise<SpreadsheetPreviewData>;
  deleteFile: (fileId: number) => Promise<void>;
  addFileToProject: (
    projectId: number,
    filePath: string,
    options: ImportOptions,
  ) => Promise<ProjectFileRecord>;

  getSegments: (fileId: number, offset: number, limit: number) => Promise<Segment[]>;
  exportFile: (
    fileId: number,
    outputPath: string,
    options?: ImportOptions,
    forceExport?: boolean,
  ) => Promise<void>;
  runFileQA: (fileId: number) => Promise<FileQaReport>;
  updateSegment: (
    segmentId: string,
    targetTokens: Token[],
    status: SegmentStatus,
    clientRequestId?: string,
  ) => Promise<SegmentUpdateResult>;

  getMatches: (projectId: number, segment: Segment) => Promise<TMMatch[]>;
  searchConcordance: (projectId: number, query: string) => Promise<TMConcordanceEntry[]>;
  getTermMatches: (projectId: number, segment: Segment) => Promise<TBMatch[]>;

  listTMs: (type?: TMType) => Promise<TMWithStats[]>;
  createTM: (name: string, srcLang: string, tgtLang: string, type?: TMType) => Promise<string>;
  deleteTM: (tmId: string) => Promise<void>;
  getProjectMountedTMs: (projectId: number) => Promise<MountedTM[]>;
  mountTMToProject: (
    projectId: number,
    tmId: string,
    priority?: number,
    permission?: string,
  ) => Promise<void>;
  unmountTMFromProject: (projectId: number, tmId: string) => Promise<void>;
  commitToMainTM: (tmId: string, fileId: number) => Promise<number>;
  matchFileWithTM: (fileId: number, tmId: string) => Promise<TMBatchMatchResult>;
  getTMImportPreview: (filePath: string) => Promise<SpreadsheetPreviewData>;
  importTMEntries: (tmId: string, filePath: string, options: TMImportOptions) => Promise<string>;

  listTBs: () => Promise<TBWithStats[]>;
  createTB: (name: string, srcLang: string, tgtLang: string) => Promise<string>;
  deleteTB: (tbId: string) => Promise<void>;
  getProjectMountedTBs: (projectId: number) => Promise<MountedTB[]>;
  mountTBToProject: (projectId: number, tbId: string, priority?: number) => Promise<void>;
  unmountTBFromProject: (projectId: number, tbId: string) => Promise<void>;
  getTBImportPreview: (filePath: string) => Promise<SpreadsheetPreviewData>;
  importTBEntries: (tbId: string, filePath: string, options: TBImportOptions) => Promise<string>;

  getAISettings: () => Promise<AISettings>;
  setAIKey: (apiKey: string) => Promise<void>;
  clearAIKey: () => Promise<void>;
  getProxySettings: () => Promise<ProxySettings>;
  setProxySettings: (settings: ProxySettingsInput) => Promise<ProxySettings>;
  testAIConnection: (apiKey?: string) => Promise<{ ok: true }>;
  aiTranslateSegment: (segmentId: string) => Promise<AISegmentTranslateResult>;
  aiRefineSegment: (segmentId: string, instruction: string) => Promise<AISegmentTranslateResult>;
  aiTranslateFile: (fileId: number, options?: AITranslateFileOptions) => Promise<string>;
  aiTestTranslate: (
    projectId: number,
    sourceText: string,
    contextText?: string,
  ) => Promise<AITestTranslateResult>;

  openFileDialog: (filters: DialogFileFilter[]) => Promise<string | null>;
  saveFileDialog: (defaultPath: string, filters: DialogFileFilter[]) => Promise<string | null>;

  onSegmentsUpdated: (callback: (data: SegmentsUpdatedEvent) => void) => () => void;
  onProgress: (callback: (data: AppProgressEvent) => void) => () => void;
  onJobProgress: (callback: (progress: JobProgressEvent) => void) => () => void;
}
