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
  ProjectSavedPromptRecord as DbProjectSavedPromptRecord,
  TBRecord as DbTBRecord,
  TMRecord as DbTMRecord,
  TMType as DbTMType,
} from '../../../../packages/db/src/types';
import type { AssetRenameApi } from './assetRenameApi';
import type { AISettingsApi } from './aiSettingsApi';
export const TM_SYNC_MAPPING_REVIEW_REQUIRED = 'TM_SYNC_MAPPING_REVIEW_REQUIRED';
export type { ProjectFileRenameResult } from './assetRenameApi';
export type {
  AddAIProviderInput,
  AIConnectionKind,
  AIConnectionSummary,
  AIProviderKind,
  AIProviderProtocol,
  AIProviderSummary,
  AISettings,
  AITestConnectionResult,
  ProxyMode,
  ProxySettings,
  ProxySettingsInput,
  SourceTerminologyPromptPreset,
  SourceTerminologyPromptSettings,
  SourceTerminologyPromptSettingsInput,
  TestAIConnectionInput,
} from './aiSettingsApi';

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

export interface TMSyncColumns {
  sourceCol: number;
  targetCol: number;
  hasHeader: boolean;
}

export type TMSyncColumnIdentity =
  | {
      kind: 'headers';
      sourceCol: number;
      targetCol: number;
      sourceHeader: string;
      targetHeader: string;
    }
  | {
      // Headerless files have no stable semantic column identity. The sync
      // still verifies that the persisted positions match the reviewed mapping.
      kind: 'positions';
      sourceCol: number;
      targetCol: number;
    };

export interface TMSyncConfigInput {
  filePath: string;
  columns: TMSyncColumns;
}

export interface TMSyncReport {
  fileRows: number;
  duplicates: number;
  skipped: number;
  added: number;
  updated: number;
  deleted: number;
  unchanged: number;
  overwrittenLocalEdits: number;
  /** Locally edited entries removed because they are missing from the synced file. */
  deletedLocalEdits: number;
  cancelled?: boolean;
}

export interface TMSyncConfig extends TMSyncConfigInput {
  /** Missing only on legacy configs that must be remapped before strict sync. */
  columnIdentity?: TMSyncColumnIdentity;
  /** Baseline for overwrittenLocalEdits: only advanced by a full success. */
  lastSyncedAt?: string;
  /** Timestamp of the latest run regardless of outcome (drives UI status). */
  lastSyncAttemptedAt?: string;
  lastSyncStatus?: 'success' | 'failed' | 'cancelled';
  lastSyncError?: string;
  lastSyncReport?: TMSyncReport;
}

export type TMSyncStartResult =
  | { status: 'started'; jobId: string }
  | { status: 'file-missing'; filePath: string }
  | { status: 'mapping-review-required'; filePath: string; reason: string };

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

export type ProjectSavedPrompt = DbProjectSavedPromptRecord;

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

export interface FileSourceTerminologyPrecheckResult {
  outputPath: string;
  summary: {
    total: number;
    ready: number;
    error: number;
    cancelled: number;
    uniqueTerms: number;
  };
}

export type TMRecord = DbTMRecord;

export interface TMWithStats extends TMRecord {
  stats: { entryCount: number };
  syncConfig?: TMSyncConfig | null;
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
  kind: 'tm-import' | 'tb-import' | 'tb-sync' | 'tm-sync';
  report?: TMSyncReport;
}

export interface StructuredJobError {
  code: string;
  message: string;
  details?: string;
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
  srcHash?: string;
  reason:
    | 'tm-created'
    | 'tm-renamed'
    | 'tm-deleted'
    | 'tm-mounted'
    | 'tm-unmounted'
    | 'tm-imported'
    | 'tm-committed'
    | 'working-tm-updated'
    | 'working-tm-reset'
    | 'tm-batch-matched'
    | 'tm-synced'
    | 'tb-created'
    | 'tb-renamed'
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

export interface DesktopApi extends AssetRenameApi, AISettingsApi {
  checkForUpdates: () => Promise<void>;
  openLocalFile: (filePath: string) => Promise<void>;

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
  listProjectSavedPrompts: (projectId: number) => Promise<ProjectSavedPrompt[]>;
  createProjectSavedPrompt: (
    projectId: number,
    name: string,
    content: string,
  ) => Promise<ProjectSavedPrompt>;
  updateProjectSavedPrompt: (
    projectId: number,
    promptId: number,
    name: string,
    content: string,
  ) => Promise<void>;
  deleteProjectSavedPrompt: (projectId: number, promptId: number) => Promise<void>;
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
  precheckSourceTerminology: (
    fileId: number,
    outputPath: string,
  ) => Promise<FileSourceTerminologyPrecheckResult>;
  cancelSourceTerminologyPrecheck: (fileId: number) => Promise<boolean>;
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
  listTMOptions: (type?: TMType) => Promise<TMRecord[]>;
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
  exportWorkingTM: (projectId: number, tmId: string, outputPath: string) => Promise<number>;
  resetWorkingTM: (projectId: number, tmId: string) => Promise<number>;
  commitToMainTM: (tmId: string, fileId: number, options?: TMCommitOptions) => Promise<number>;
  matchFileWithTM: (fileId: number, tmId: string) => Promise<TMBatchMatchResult>;
  getTMImportPreview: (filePath: string) => Promise<SpreadsheetPreviewData>;
  importTMEntries: (tmId: string, filePath: string, options: TMImportOptions) => Promise<string>;
  setTMSyncConfig: (tmId: string, config: TMSyncConfigInput) => Promise<void>;
  syncTMWithExcel: (tmId: string) => Promise<TMSyncStartResult>;
  cancelTMSync: (tmId: string, jobId: string) => Promise<boolean>;

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
