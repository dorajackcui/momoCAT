import type { QaIssue, Segment, SegmentStatus, TBEntry, TMEntry, Token } from '@cat/core/models';
import type { Project, ProjectAIModel, ProjectQASettings, ProjectType } from '@cat/core/project';
import type {
  MountedTBRecord,
  MountedTMRecord,
  ProjectFileRecord,
  ProjectListRecord,
  ProjectTermEntryRecord,
  TBRecord,
  TMConcordanceRecallOptions,
  TMEntryRow,
  TMRecallOptions,
  TMRecord,
  TMType,
} from '@cat/db';

export type {
  MountedTBRecord,
  MountedTMRecord,
  ProjectFileRecord,
  ProjectListRecord,
  ProjectTermEntryRecord,
  TBRecord,
  TMConcordanceRecallOptions,
  TMEntryRow,
  TMRecallOptions,
  TMRecord,
  TMType,
};

export type ProjectRecord = Project;
export type TMEntryWithTmId = TMEntry & { tmId: string };

export interface TMFtsReplacement {
  tmId: string;
  srcText: string;
  tgtText: string;
  tmEntryId: string;
}

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
  listTMEntries(tmId: string, limit?: number, offset?: number): TMEntryWithTmId[];
  listTMs(type?: TMType): TMRecord[];
  createTM(name: string, srcLang: string, tgtLang: string, type: TMType): string;
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
  deleteTermBase(id: string): void;
  getTermBase(tbId: string): TBRecord | undefined;
  getTermBaseStats(tbId: string): { entryCount: number; maxEntryUpdatedAt?: string | null };
  getProjectMountedTermBases(projectId: number): MountedTBRecord[];
  mountTermBaseToProject(projectId: number, tbId: string, priority?: number): void;
  unmountTermBaseFromProject(projectId: number, tbId: string): void;
  listProjectTermEntries(projectId: number): ProjectTermEntryRecord[];
  searchProjectTermEntries(
    projectId: number,
    sourceText: string,
    options?: { srcLang?: string; limit?: number },
  ): ProjectTermEntryRecord[];
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

export interface AITransport {
  listModels(params: {
    apiKey: string;
    baseUrl: string;
  }): Promise<{
    models: string[];
    status: number;
    endpoint: string;
    rawResponseText?: string;
  }>;
  testConnection(params: {
    apiKey: string;
    baseUrl: string;
    model: string;
  }): Promise<{
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
