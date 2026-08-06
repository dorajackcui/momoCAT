import {
  QaIssue,
  RepeatPropagationState,
  Segment,
  SegmentStatus,
  TBEntry,
  TMEntry,
  Token,
} from '@cat/core/models';
import { Project, ProjectAIModel, ProjectQASettings, ProjectType } from '@cat/core/project';
import type {
  MountedTBRecord as DbMountedTBRecord,
  MountedTMRecord as DbMountedTMRecord,
  ProjectFileRecord as DbProjectFileRecord,
  ProjectSavedPromptRecord as DbProjectSavedPromptRecord,
  TBRecord as DbTBRecord,
  TMConcordanceRecallOptions as DbTMConcordanceRecallOptions,
  TMRecord as DbTMRecord,
  TMRecallOptions as DbTMRecallOptions,
  TMType as DbTMType,
} from '../../../../../packages/db/src/types';
import type {
  ImportOptions as SharedImportOptions,
  ProjectWithStats,
  SpreadsheetPreviewData as SharedSpreadsheetPreviewData,
} from '../../shared/ipc';

export type TMType = DbTMType;
export type TMRecallOptions = DbTMRecallOptions;
export type TMConcordanceRecallOptions = DbTMConcordanceRecallOptions;
export type SpreadsheetPreviewData = SharedSpreadsheetPreviewData;

export type ProjectRecord = Project;
export type ProjectListRecord = ProjectWithStats;

export type ProjectFileRecord = DbProjectFileRecord;

export type ProjectSavedPromptRecord = DbProjectSavedPromptRecord;

export type TMRecord = DbTMRecord;

export type MountedTMRecord = DbMountedTMRecord;

export type TMEntryWithTmId = TMEntry & {
  tmId: string;
};

export interface TMFtsReplacement {
  tmId: string;
  srcText: string;
  tgtText: string;
  tmEntryId: string;
}

export type TMConcordanceRecord = TMEntryWithTmId & {
  tmName: string;
  tmType: TMType;
};

export type TBRecord = DbTBRecord;

export type MountedTBRecord = DbMountedTBRecord;

export interface ProjectRepository {
  createProject(name: string, srcLang: string, tgtLang: string, projectType?: ProjectType): number;
  listProjects(): ProjectListRecord[];
  getProject(id: number): ProjectRecord | undefined;
  updateProjectPrompt(projectId: number, aiPrompt: string | null): void;
  updateProjectAISettings(
    projectId: number,
    aiPrompt: string | null,
    aiModel: ProjectAIModel | null,
  ): void;
  updateProjectQASettings(projectId: number, qaSettings: ProjectQASettings): void;
  deleteProject(id: number): void;

  listProjectSavedPrompts(projectId: number): ProjectSavedPromptRecord[];
  createProjectSavedPrompt(
    projectId: number,
    name: string,
    content: string,
  ): ProjectSavedPromptRecord;
  updateProjectSavedPrompt(
    projectId: number,
    promptId: number,
    name: string,
    content: string,
  ): void;
  deleteProjectSavedPrompt(projectId: number, promptId: number): void;

  createFile(projectId: number, name: string, importOptionsJson?: string): number;
  listFiles(projectId: number): ProjectFileRecord[];
  getFile(id: number): ProjectFileRecord | undefined;
  deleteFile(id: number): void;
}

export interface SegmentRepository {
  bulkInsertSegments(segments: Segment[]): void;
  getSegmentsPage(fileId: number, offset: number, limit: number): Segment[];
  getSegment(segmentId: string): Segment | undefined;
  getProjectIdByFileId(fileId: number): number | undefined;
  getProjectTypeByFileId(fileId: number): ProjectType | undefined;
  getProjectSegmentsByHash(projectId: number, srcHash: string, fileId?: number): Segment[];
  updateSegmentTarget(
    segmentId: string,
    targetTokens: Token[],
    status: SegmentStatus,
    repeatPropagation?: RepeatPropagationState | null,
  ): void;
  updateSegmentQaIssues(segmentId: string, qaIssues: QaIssue[]): void;
}

export interface TMRepository {
  upsertTMEntryBySrcHash(entry: TMEntry & { tmId: string }): string;
  insertTMEntryIfAbsentBySrcHash(entry: TMEntry & { tmId: string }): string | undefined;
  applyTMSyncUpdates(
    tmId: string,
    rows: Array<{
      entryId: string;
      sourceTokensJson: string;
      targetTokensJson: string;
      srcText: string;
      tgtText: string;
    }>,
  ): number;
  insertTMFts(tmId: string, srcText: string, tgtText: string, tmEntryId: string): void;
  replaceTMFts(tmId: string, srcText: string, tgtText: string, tmEntryId: string): void;
  replaceTMFtsBatch(rows: TMFtsReplacement[]): void;
  findTMEntryByHash(tmId: string, srcHash: string): TMEntry | undefined;
  searchConcordance(projectId: number, query: string, tmIds?: string[]): TMEntryWithTmId[];
  searchTMRecallCandidates(
    projectId: number,
    sourceText: string,
    tmIds?: string[],
    options?: TMRecallOptions,
  ): TMEntryWithTmId[];
  searchTMFuzzyRecallCandidates(
    projectId: number,
    sourceText: string,
    tmIds?: string[],
    options?: TMRecallOptions,
  ): TMEntryWithTmId[];
  searchTMConcordanceRecallCandidates(
    projectId: number,
    queryText: string,
    tmIds?: string[],
    options?: TMConcordanceRecallOptions,
  ): TMEntryWithTmId[];

  listTMs(type?: TMType): TMRecord[];
  listTMEntries(tmId: string, limit?: number, offset?: number): TMEntryWithTmId[];
  createTM(name: string, srcLang: string, tgtLang: string, type: TMType): string;
  renameTM(id: string, name: string): void;
  deleteTM(id: string): void;
  getTM(tmId: string): TMRecord | undefined;
  getTMStats(tmId: string): { entryCount: number; maxEntryUpdatedAt?: string | null };
  getProjectMountedTMs(projectId: number): MountedTMRecord[];
  mountTMToProject(projectId: number, tmId: string, priority?: number, permission?: string): void;
  unmountTMFromProject(projectId: number, tmId: string): void;
}

export interface TBRepository {
  listTermBases(): TBRecord[];
  createTermBase(name: string, srcLang: string, tgtLang: string): string;
  renameTermBase(id: string, name: string): void;
  deleteTermBase(id: string): void;
  clearTermBaseEntries(tbId: string): void;
  getTermBase(tbId: string): TBRecord | undefined;
  getTermBaseStats(tbId: string): { entryCount: number; maxEntryUpdatedAt?: string | null };
  getTBDataVersion(): number;
  getProjectMountedTermBases(projectId: number): MountedTBRecord[];
  mountTermBaseToProject(projectId: number, tbId: string, priority?: number): void;
  unmountTermBaseFromProject(projectId: number, tbId: string): void;
  listTBEntries(tbId: string, limit?: number, offset?: number): TBEntry[];
  listProjectTermEntries(projectId: number): Array<TBEntry & { tbName: string; priority: number }>;
  searchProjectTermEntries(
    projectId: number,
    sourceText: string,
    options?: { srcLang?: string; limit?: number },
  ): Array<TBEntry & { tbName: string; priority: number }>;
  upsertTBEntryBySrcTerm(params: {
    id: string;
    tbId: string;
    srcLang: string;
    srcTerm: string;
    tgtTerm: string;
    note?: string | null;
    usageCount?: number;
  }): string;
  insertTBEntryIfAbsentBySrcTerm(params: {
    id: string;
    tbId: string;
    srcLang: string;
    srcTerm: string;
    tgtTerm: string;
    note?: string | null;
    usageCount?: number;
  }): string | undefined;
}

export interface SettingsRepository {
  getSetting(key: string): string | undefined;
  setSetting(key: string, value: string | null): void;
}

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface AiModelRuntimeConfig {
  reasoningEffort: ReasoningEffort;
}

export interface AIRuntimeConfigProvider {
  getModelConfig(model: string): Promise<AiModelRuntimeConfig>;
}

export interface TransactionManager {
  runInTransaction<T>(fn: () => T): T;
}

export interface SpreadsheetGateway {
  import(
    filePath: string,
    projectId: number,
    fileId: number,
    options: ImportOptions,
  ): Promise<Segment[]>;
  export(
    originalFilePath: string,
    segments: Segment[],
    options: ImportOptions,
    outputPath: string,
  ): Promise<void>;
  getPreview(filePath: string, rowLimit?: number): Promise<SpreadsheetPreviewData>;
}

export type ImportOptions = SharedImportOptions;

export interface ProgressPayload {
  type: string;
  current: number;
  total: number;
  message?: string;
}

export interface SegmentsUpdatedPayload {
  fileId: number;
  segmentId: string;
  targetTokens: Token[];
  status: SegmentStatus;
  propagatedIds: string[];
  clientRequestId?: string;
  serverAppliedAt: string;
}

export type ProgressEmitter = (payload: ProgressPayload) => void;

export interface AITransport {
  listModels(params: { apiKey: string; baseUrl: string }): Promise<{
    models: string[];
    status: number;
    endpoint: string;
    rawResponseText?: string;
  }>;
  testConnection(params: { apiKey: string; baseUrl: string; model: string }): Promise<{
    ok: true;
    status: number;
    endpoint: string;
    rawResponseText?: string;
  }>;
  createResponse(params: {
    apiKey: string;
    baseUrl: string;
    model: string;
    reasoningEffort: ReasoningEffort;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<{
    content: string;
    requestId?: string;
    status: number;
    endpoint: string;
    rawResponseText?: string;
  }>;
}
