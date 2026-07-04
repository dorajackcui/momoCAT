import type { Segment, SegmentStatus, TBMatch, TMEntry, Token } from '@cat/core/models';
import type {
  FileQaReport,
  Project,
  ProjectAIModel as CoreProjectAIModel,
  ProjectQASettings,
  ProjectType as CoreProjectType,
} from '@cat/core/project';
import type { TagPolicy } from '@cat/core/tag';
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
  tagPolicy?: TagPolicy;
}

export interface ClipboardContent {
  text: string;
  html: string;
}

export interface PastedSourceFileInput {
  sources: string[];
  tagPolicy?: TagPolicy;
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

export interface TBSyncColumns {
  sourceCol: number;
  targetCol: number;
  noteCol?: number;
  hasHeader: boolean;
}

export interface TBSyncConfigInput {
  filePath: string;
  columns: TBSyncColumns;
}

export interface TBSyncConfig extends TBSyncConfigInput {
  lastSyncedAt?: string;
  lastSyncStatus?: 'success' | 'failed';
  lastSyncError?: string;
}

export type TBSyncStartResult =
  | { status: 'started'; jobId: string }
  | { status: 'file-missing'; filePath: string };

export type SpreadsheetPreviewCell = string | number | boolean | null | undefined;
export type SpreadsheetPreviewData = SpreadsheetPreviewCell[][];

export type ProjectWithStats = Project & {
  progress: number;
  fileCount: number;
};

export type ProjectFileRecord = DbProjectFileRecord;

export interface FileInspectResult {
  outputPath: string;
  jsonOutputPath: string;
  summary: {
    total: number;
    ready: number;
    error: number;
  };
}

export interface FileReferenceExportResult {
  outputPath: string;
  summary: {
    total: number;
    ready: number;
    error: number;
  };
}

export type TMRecord = DbTMRecord;

export interface TMWithStats extends TMRecord {
  stats: { entryCount: number };
}

export interface TMPreviewRow {
  id: string;
  source: string;
  target: string;
  updatedAt: string;
  usageCount: number;
}

export interface TMAssetPreview {
  tmId: string;
  rows: TMPreviewRow[];
}

export type MountedTM = DbMountedTMRecord & {
  entryCount: number;
};

export type TBRecord = DbTBRecord;

export interface TBWithStats extends TBRecord {
  stats: { entryCount: number };
  syncConfig?: TBSyncConfig | null;
}

export interface TBPreviewRow {
  id: string;
  sourceTerm: string;
  targetTerm: string;
  note?: string | null;
  updatedAt: string;
  usageCount: number;
}

export interface TBAssetPreview {
  tbId: string;
  rows: TBPreviewRow[];
}

export type MountedTB = DbMountedTBRecord & {
  stats: { entryCount: number };
};

export type TMMatchKind = 'tm' | 'concordance';

export interface TMMatchBase extends TMEntry {
  kind: TMMatchKind;
  rank: number;
  tmName: string;
  tmType: TMType;
}

export interface StandardTMMatch extends TMMatchBase {
  kind: 'tm';
  similarity: number;
}

export interface ConcordanceTMMatch extends TMMatchBase {
  kind: 'concordance';
  matchedSourceText: string;
  sourceCoverage: number;
  entryCoverage: number;
}

export type TMMatch = StandardTMMatch | ConcordanceTMMatch;

export interface TMConcordanceEntry extends TMEntry {
  tmId: string;
  tmName: string;
  tmType: TMType;
}

export interface SegmentUpdateResult {
  fileId: number;
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

export type TMCommitScope = 'confirmed-only' | 'all';

export interface TMCommitOptions {
  scope?: TMCommitScope;
}

export interface ImportExecutionResult {
  success: number;
  skipped: number;
}

export interface ImportJobResult extends ImportExecutionResult {
  kind: 'tm-import' | 'tb-import' | 'tb-sync';
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

export type AIProviderKind = 'configured' | 'legacy';
export type AIConnectionKind = 'openai-compatible';
export type AIProviderProtocol = 'chat-completions';

export interface AIConnectionSummary {
  id: string;
  name: string;
  baseUrl: string;
  protocol: AIProviderProtocol;
  kind: AIConnectionKind;
  apiKeyLast4?: string;
  discoveredModels: string[];
  lastTestedAt?: string;
  lastRefreshedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AIProviderSummary {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  protocol: AIProviderProtocol;
  kind: AIProviderKind;
  connectionId: string;
  connectionName: string;
  apiKeyLast4?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TestAIConnectionInput {
  connectionId?: string;
  name: string;
  baseUrl: string;
  apiKey: string;
}

export interface AITestConnectionResult {
  ok: boolean;
  connection?: AIConnectionSummary;
  models?: string[];
  error?: string;
  status?: number;
  endpoint?: string;
  rawResponseText?: string;
}

export interface AddAIProviderInput {
  name: string;
  connectionId: string;
  model: string;
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
  systemPrompt: string;
  userPrompt: string;
  translatedText: string;
  requestId?: string;
  status?: number;
  endpoint?: string;
  model?: string;
  rawResponseText?: string;
  responseContent?: string;
}

export interface AISegmentTranslateResult {
  fileId: number;
  segmentId: string;
  targetTokens: Token[];
  status: SegmentStatus;
  propagatedIds: string[];
  serverAppliedAt: string;
}

export type AIBatchMode = 'default' | 'dialogue';
export type AIBatchTargetScope = 'blank-only' | 'overwrite-non-confirmed';
export type AIBatchTargetBaseline = 'use-current-targets' | 'ignore-current-targets';

export interface AITranslateFileOptions {
  mode?: AIBatchMode;
  targetScope?: AIBatchTargetScope;
  targetBaseline?: AIBatchTargetBaseline;
}

export interface SegmentsUpdatedEvent {
  fileId: number;
  segmentId: string;
  targetTokens: Token[];
  status: SegmentStatus;
  propagatedIds: string[];
  clientRequestId?: string;
  serverAppliedAt: string;
}

export type SegmentsUpdatedBatchEvent = SegmentsUpdatedEvent[];

export interface AppProgressEvent {
  type: string;
  current: number;
  total: number;
  message?: string;
  scope?: string;
}

export interface JobProgressEvent {
  jobId: string;
  progress: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  message?: string;
  cancelRequested?: boolean;
  result?: ImportJobResult;
  error?: StructuredJobError;
}

export type AppUpdatePhase =
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error';

export interface AppUpdateStatusEvent {
  phase: AppUpdatePhase;
  message: string;
  version?: string;
  percent?: number;
}

export interface ReferenceDataChangedEvent {
  projectId: number | null;
  kind: 'tm' | 'tb';
  reason:
    | 'tm-created'
    | 'tm-deleted'
    | 'tm-mounted'
    | 'tm-unmounted'
    | 'tm-imported'
    | 'tm-committed'
    | 'tm-batch-matched'
    | 'tb-created'
    | 'tb-deleted'
    | 'tb-mounted'
    | 'tb-unmounted'
    | 'tb-imported'
    | 'tb-synced';
}

export interface DialogFileFilter {
  name: string;
  extensions: string[];
}

export interface DesktopApi {
  checkForUpdates: () => Promise<void>;

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
    aiProviderId: ProjectAIModel | null,
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
  createPastedSourceFile: (
    projectId: number,
    input: PastedSourceFileInput,
  ) => Promise<ProjectFileRecord>;

  getSegments: (fileId: number, offset: number, limit: number) => Promise<Segment[]>;
  exportFile: (
    fileId: number,
    outputPath: string,
    options?: ImportOptions,
    forceExport?: boolean,
  ) => Promise<void>;
  runFileQA: (fileId: number) => Promise<FileQaReport>;
  inspectFile: (fileId: number, outputPath: string) => Promise<FileInspectResult>;
  exportReferencesForMt: (fileId: number, outputPath: string) => Promise<FileReferenceExportResult>;
  updateSegment: (
    segmentId: string,
    targetTokens: Token[],
    status: SegmentStatus,
    clientRequestId?: string,
  ) => Promise<SegmentUpdateResult>;

  getMatches: (projectId: number, segment: Segment) => Promise<TMMatch[]>;
  searchConcordance: (projectId: number, query: string) => Promise<TMConcordanceEntry[]>;
  getTermMatches: (projectId: number, segment: Segment) => Promise<TBMatch[]>;
  prefetchMatches: (projectId: number, segment: Segment) => Promise<TMMatch[]>;
  prefetchTermMatches: (projectId: number, segment: Segment) => Promise<TBMatch[]>;

  listTMs: (type?: TMType) => Promise<TMWithStats[]>;
  getTMPreview: (tmId: string) => Promise<TMAssetPreview>;
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
  commitToMainTM: (tmId: string, fileId: number, options?: TMCommitOptions) => Promise<number>;
  matchFileWithTM: (fileId: number, tmId: string) => Promise<TMBatchMatchResult>;
  getTMImportPreview: (filePath: string) => Promise<SpreadsheetPreviewData>;
  importTMEntries: (tmId: string, filePath: string, options: TMImportOptions) => Promise<string>;

  listTBs: () => Promise<TBWithStats[]>;
  getTBPreview: (tbId: string) => Promise<TBAssetPreview>;
  createTB: (name: string, srcLang: string, tgtLang: string) => Promise<string>;
  deleteTB: (tbId: string) => Promise<void>;
  getProjectMountedTBs: (projectId: number) => Promise<MountedTB[]>;
  mountTBToProject: (projectId: number, tbId: string, priority?: number) => Promise<void>;
  unmountTBFromProject: (projectId: number, tbId: string) => Promise<void>;
  getTBImportPreview: (filePath: string) => Promise<SpreadsheetPreviewData>;
  importTBEntries: (tbId: string, filePath: string, options: TBImportOptions) => Promise<string>;
  setTBSyncConfig: (tbId: string, config: TBSyncConfigInput) => Promise<void>;
  syncTBWithExcel: (tbId: string) => Promise<TBSyncStartResult>;

  getAISettings: () => Promise<AISettings>;
  listAIConnections: () => Promise<AIConnectionSummary[]>;
  testAIConnection: (input: TestAIConnectionInput) => Promise<AITestConnectionResult>;
  deleteAIConnection: (connectionId: string) => Promise<void>;
  listAIProviders: () => Promise<AIProviderSummary[]>;
  addAIProvider: (input: AddAIProviderInput) => Promise<AIProviderSummary>;
  deleteAIProvider: (providerId: string) => Promise<void>;
  getProxySettings: () => Promise<ProxySettings>;
  setProxySettings: (settings: ProxySettingsInput) => Promise<ProxySettings>;
  aiTranslateSegment: (segmentId: string) => Promise<AISegmentTranslateResult>;
  aiRefineSegment: (segmentId: string, instruction: string) => Promise<AISegmentTranslateResult>;
  aiTranslateFile: (fileId: number, options?: AITranslateFileOptions) => Promise<string>;
  aiCancelFileJob: (jobId: string) => Promise<boolean>;
  aiTestTranslate: (
    projectId: number,
    sourceText: string,
    contextText?: string,
  ) => Promise<AITestTranslateResult>;

  openFileDialog: (filters: DialogFileFilter[]) => Promise<string | null>;
  saveFileDialog: (defaultPath: string, filters: DialogFileFilter[]) => Promise<string | null>;
  readClipboard: () => Promise<ClipboardContent>;

  onSegmentsUpdated: (callback: (data: SegmentsUpdatedEvent) => void) => () => void;
  onSegmentsUpdatedBatch: (callback: (batch: SegmentsUpdatedBatchEvent) => void) => () => void;
  onProgress: (callback: (data: AppProgressEvent) => void) => () => void;
  onJobProgress: (callback: (progress: JobProgressEvent) => void) => () => void;
  getJobStatus: (jobId: string) => Promise<JobProgressEvent | null>;
  onAppUpdateStatus: (callback: (status: AppUpdateStatusEvent) => void) => () => void;
  onReferenceDataChanged: (callback: (event: ReferenceDataChangedEvent) => void) => () => void;
}
