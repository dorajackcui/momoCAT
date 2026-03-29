import { QaIssue, Segment, SegmentStatus, TBEntry, TMEntry, Token } from '@cat/core/models';
import { Project, ProjectAIModel, ProjectQASettings, ProjectType } from '@cat/core/project';
import type {
  MountedTBRecord as DbMountedTBRecord,
  MountedTMRecord as DbMountedTMRecord,
  ProjectFileRecord as DbProjectFileRecord,
  TBRecord as DbTBRecord,
  TMRecord as DbTMRecord,
  TMType as DbTMType,
} from '../../../../../packages/db/src/types';
import type {
  ImportOptions as SharedImportOptions,
  ProjectWithStats,
  SpreadsheetPreviewData as SharedSpreadsheetPreviewData,
} from '../../shared/ipc';

export type TMType = DbTMType;
export type SpreadsheetPreviewData = SharedSpreadsheetPreviewData;

export type ProjectRecord = Project;
export type ProjectListRecord = ProjectWithStats;

export type ProjectFileRecord = DbProjectFileRecord;

export type TMRecord = DbTMRecord;

export type MountedTMRecord = DbMountedTMRecord;

export type TMEntryWithTmId = TMEntry & {
  tmId: string;
};

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
  getProjectSegmentsByHash(projectId: number, srcHash: string): Segment[];
  updateSegmentTarget(segmentId: string, targetTokens: Token[], status: SegmentStatus): void;
  updateSegmentQaIssues(segmentId: string, qaIssues: QaIssue[]): void;
}

export interface TMRepository {
  upsertTMEntryBySrcHash(entry: TMEntry & { tmId: string }): string;
  insertTMEntryIfAbsentBySrcHash(entry: TMEntry & { tmId: string }): string | undefined;
  insertTMFts(tmId: string, srcText: string, tgtText: string, tmEntryId: string): void;
  replaceTMFts(tmId: string, srcText: string, tgtText: string, tmEntryId: string): void;
  findTMEntryByHash(tmId: string, srcHash: string): TMEntry | undefined;
  searchConcordance(projectId: number, query: string): TMEntryWithTmId[];

  listTMs(type?: TMType): TMRecord[];
  createTM(name: string, srcLang: string, tgtLang: string, type: TMType): string;
  deleteTM(id: string): void;
  getTM(tmId: string): TMRecord | undefined;
  getTMStats(tmId: string): { entryCount: number };
  getProjectMountedTMs(projectId: number): MountedTMRecord[];
  mountTMToProject(projectId: number, tmId: string, priority?: number, permission?: string): void;
  unmountTMFromProject(projectId: number, tmId: string): void;
}

export interface TBRepository {
  listTermBases(): TBRecord[];
  createTermBase(name: string, srcLang: string, tgtLang: string): string;
  deleteTermBase(id: string): void;
  getTermBase(tbId: string): TBRecord | undefined;
  getTermBaseStats(tbId: string): { entryCount: number };
  getProjectMountedTermBases(projectId: number): MountedTBRecord[];
  mountTermBaseToProject(projectId: number, tbId: string, priority?: number): void;
  unmountTermBaseFromProject(projectId: number, tbId: string): void;
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
  getModelConfig(model: ProjectAIModel): Promise<AiModelRuntimeConfig>;
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
  segmentId: string;
  targetTokens: Token[];
  status: SegmentStatus;
  propagatedIds: string[];
  clientRequestId?: string;
  serverAppliedAt: string;
}

export type ProgressEmitter = (payload: ProgressPayload) => void;

export interface AITransport {
  testConnection(apiKey: string): Promise<{ ok: true }>;
  createResponse(params: {
    apiKey: string;
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
