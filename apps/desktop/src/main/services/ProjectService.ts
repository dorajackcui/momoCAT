import { Segment, SegmentStatus, Token } from '@cat/core/models';
import type {
  FileQaReport,
  ProjectAIModel,
  ProjectQASettings,
  ProjectType,
} from '@cat/core/project';
import { CATDatabase } from '@cat/db';
import { SpreadsheetFilter } from '../filters/SpreadsheetFilter';
import { TMService } from './TMService';
import { SegmentService } from './SegmentService';
import { TBService } from './TBService';
import {
  AIRuntimeConfigProvider,
  AITransport,
  SegmentsUpdatedPayload,
  SpreadsheetGateway,
  SpreadsheetPreviewData,
} from './ports';
import { OpenAITransport } from './providers/OpenAITransport';
import { ProjectFileModule } from './modules/ProjectFileModule';
import { TMModule } from './modules/TMModule';
import { TBModule } from './modules/TBModule';
import { AIModule } from './modules/AIModule';
import { SqliteProjectRepository } from './adapters/SqliteProjectRepository';
import { SqliteSegmentRepository } from './adapters/SqliteSegmentRepository';
import { SqliteTMRepository } from './adapters/SqliteTMRepository';
import { SqliteTBRepository } from './adapters/SqliteTBRepository';
import { SqliteSettingsRepository } from './adapters/SqliteSettingsRepository';
import { SqliteTransactionManager } from './adapters/SqliteTransactionManager';
import { ProxySettingsManager } from './proxy/ProxySettingsManager';
import type {
  AIBatchMode,
  AIBatchTargetScope,
  ImportOptions,
  ProxySettings,
  ProxySettingsInput,
  TBImportOptions,
  TMImportOptions,
} from '../../shared/ipc';

interface ProjectServiceDependencies {
  filter?: SpreadsheetGateway;
  tmService?: TMService;
  tbService?: TBService;
  segmentService?: SegmentService;
  aiTransport?: AITransport;
  aiRuntimeConfigProvider?: AIRuntimeConfigProvider;
  projectModule?: ProjectFileModule;
  tmModule?: TMModule;
  tbModule?: TBModule;
  aiModule?: AIModule;
}

interface ImportProgress {
  current: number;
  total: number;
  message?: string;
}

export class ProjectService {
  private readonly segmentService: SegmentService;
  private readonly projectModule: ProjectFileModule;
  private readonly tmModule: TMModule;
  private readonly tbModule: TBModule;
  private readonly aiModule: AIModule;
  private progressCallbacks: ((data: {
    type: string;
    current: number;
    total: number;
    message?: string;
  }) => void)[] = [];

  constructor(
    db: CATDatabase,
    projectsDir: string,
    dbPath: string,
    deps: ProjectServiceDependencies = {},
  ) {
    const projectRepo = new SqliteProjectRepository(db);
    const segmentRepo = new SqliteSegmentRepository(db);
    const tmRepo = new SqliteTMRepository(db);
    const tbRepo = new SqliteTBRepository(db);
    const settingsRepo = new SqliteSettingsRepository(db);
    const tx = new SqliteTransactionManager(db);

    const filter = deps.filter ?? new SpreadsheetFilter();
    const tmService = deps.tmService ?? new TMService(projectRepo, tmRepo);
    const tbService = deps.tbService ?? new TBService(projectRepo, tbRepo);
    this.segmentService = deps.segmentService ?? new SegmentService(segmentRepo, tmService, tx);

    const emitProgress = (payload: {
      type: string;
      current: number;
      total: number;
      message?: string;
    }) => {
      this.emitProgress(payload.type, payload.current, payload.total, payload.message);
    };

    this.projectModule =
      deps.projectModule ?? new ProjectFileModule(projectRepo, segmentRepo, filter, projectsDir);
    this.tmModule =
      deps.tmModule ??
      new TMModule(
        projectRepo,
        segmentRepo,
        tmRepo,
        tx,
        tmService,
        this.segmentService,
        dbPath,
        emitProgress,
      );
    this.tbModule = deps.tbModule ?? new TBModule(tbRepo, tx, tbService, emitProgress);

    const aiTransport = deps.aiTransport ?? new OpenAITransport();
    const aiRuntimeConfigProvider = deps.aiRuntimeConfigProvider;
    this.aiModule =
      deps.aiModule ??
      new AIModule(
        projectRepo,
        segmentRepo,
        settingsRepo,
        this.segmentService,
        aiTransport,
        new ProxySettingsManager(),
        aiRuntimeConfigProvider,
        {
          tmService,
          tbService,
        },
      );

    try {
      this.aiModule.applySavedProxySettings();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Proxy] Failed to apply saved proxy settings: ${message}`);
    }
  }

  public async createProject(
    name: string,
    srcLang: string,
    tgtLang: string,
    projectType: ProjectType = 'translation',
  ) {
    return this.projectModule.createProject(name, srcLang, tgtLang, projectType);
  }

  public async addFileToProject(projectId: number, filePath: string, options: ImportOptions) {
    return this.projectModule.addFileToProject(projectId, filePath, options);
  }

  public listProjects() {
    return this.projectModule.listProjects();
  }

  public listFiles(projectId: number) {
    return this.projectModule.listFiles(projectId);
  }

  public getFile(fileId: number) {
    return this.projectModule.getFile(fileId);
  }

  public getProject(projectId: number) {
    return this.projectModule.getProject(projectId);
  }

  public updateProjectPrompt(projectId: number, aiPrompt: string | null) {
    this.projectModule.updateProjectPrompt(projectId, aiPrompt);
  }

  public updateProjectAISettings(
    projectId: number,
    aiPrompt: string | null,
    aiModel: ProjectAIModel | null,
  ) {
    this.projectModule.updateProjectAISettings(projectId, aiPrompt, aiModel);
  }

  public updateProjectQASettings(projectId: number, qaSettings: ProjectQASettings) {
    this.projectModule.updateProjectQASettings(projectId, qaSettings);
  }

  public async deleteProject(projectId: number) {
    return this.projectModule.deleteProject(projectId);
  }

  public async deleteFile(fileId: number) {
    return this.projectModule.deleteFile(fileId);
  }

  public getSegments(fileId: number, offset: number, limit: number): Segment[] {
    return this.segmentService.getSegments(fileId, offset, limit);
  }

  public async getSpreadsheetPreview(filePath: string): Promise<SpreadsheetPreviewData> {
    return this.projectModule.getSpreadsheetPreview(filePath);
  }

  public async updateSegment(
    segmentId: string,
    targetTokens: Token[],
    status: SegmentStatus,
    clientRequestId?: string,
  ) {
    return this.segmentService.updateSegment(segmentId, targetTokens, status, clientRequestId);
  }

  public onSegmentsUpdated(callback: (data: SegmentsUpdatedPayload) => void) {
    this.segmentService.on('segments-updated', callback);
    return () => this.segmentService.off('segments-updated', callback);
  }

  public onProgress(
    callback: (data: { type: string; current: number; total: number; message?: string }) => void,
  ) {
    this.progressCallbacks.push(callback);
    return () => {
      this.progressCallbacks = this.progressCallbacks.filter((c) => c !== callback);
    };
  }

  private emitProgress(type: string, current: number, total: number, message?: string) {
    this.progressCallbacks.forEach((cb) => cb({ type, current, total, message }));
  }

  public async findMatches(projectId: number, segment: Segment) {
    return this.tmModule.findMatches(projectId, segment);
  }

  public async findTermMatches(projectId: number, segment: Segment) {
    return this.tbModule.findTermMatches(projectId, segment);
  }

  public async searchConcordance(projectId: number, query: string) {
    return this.tmModule.searchConcordance(projectId, query);
  }

  public async listTMs(type?: 'working' | 'main') {
    return this.tmModule.listTMs(type);
  }

  public async createTM(
    name: string,
    srcLang: string,
    tgtLang: string,
    type: 'working' | 'main' = 'main',
  ) {
    return this.tmModule.createTM(name, srcLang, tgtLang, type);
  }

  public async deleteTM(tmId: string) {
    return this.tmModule.deleteTM(tmId);
  }

  public async getProjectMountedTMs(projectId: number) {
    return this.tmModule.getProjectMountedTMs(projectId);
  }

  public async mountTMToProject(
    projectId: number,
    tmId: string,
    priority?: number,
    permission?: string,
  ) {
    return this.tmModule.mountTMToProject(projectId, tmId, priority, permission);
  }

  public async unmountTMFromProject(projectId: number, tmId: string) {
    return this.tmModule.unmountTMFromProject(projectId, tmId);
  }

  public async listTBs() {
    return this.tbModule.listTBs();
  }

  public async createTB(name: string, srcLang: string, tgtLang: string) {
    return this.tbModule.createTB(name, srcLang, tgtLang);
  }

  public async deleteTB(tbId: string) {
    return this.tbModule.deleteTB(tbId);
  }

  public async getProjectMountedTBs(projectId: number) {
    return this.tbModule.getProjectMountedTBs(projectId);
  }

  public async mountTBToProject(projectId: number, tbId: string, priority?: number) {
    return this.tbModule.mountTBToProject(projectId, tbId, priority);
  }

  public async unmountTBFromProject(projectId: number, tbId: string) {
    return this.tbModule.unmountTBFromProject(projectId, tbId);
  }

  public async getTMImportPreview(filePath: string): Promise<SpreadsheetPreviewData> {
    return this.tmModule.getTMImportPreview(filePath);
  }

  public async importTMEntries(
    tmId: string,
    filePath: string,
    options: TMImportOptions,
    onProgress?: (progress: ImportProgress) => void,
  ): Promise<{ success: number; skipped: number }> {
    return this.tmModule.importTMEntries(tmId, filePath, options, onProgress);
  }

  public async getTBImportPreview(filePath: string): Promise<SpreadsheetPreviewData> {
    return this.tbModule.getTBImportPreview(filePath);
  }

  public async importTBEntries(
    tbId: string,
    filePath: string,
    options: TBImportOptions,
    onProgress?: (progress: ImportProgress) => void,
  ): Promise<{ success: number; skipped: number }> {
    return this.tbModule.importTBEntries(tbId, filePath, options, onProgress);
  }

  public async commitToMainTM(tmId: string, fileId: number) {
    return this.tmModule.commitToMainTM(tmId, fileId);
  }

  public async batchMatchFileWithTM(
    fileId: number,
    tmId: string,
  ): Promise<{ total: number; matched: number; applied: number; skipped: number }> {
    return this.tmModule.batchMatchFileWithTM(fileId, tmId);
  }

  public async exportFile(
    fileId: number,
    outputPath: string,
    options?: ImportOptions,
    forceExport: boolean = false,
  ) {
    return this.projectModule.exportFile(fileId, outputPath, options, forceExport);
  }

  public async runFileQA(fileId: number): Promise<FileQaReport> {
    return this.projectModule.runFileQA(fileId, (projectId, segment) =>
      this.tbModule.findTermMatches(projectId, segment),
    );
  }

  public getAISettings(): { apiKeySet: boolean; apiKeyLast4?: string } {
    return this.aiModule.getAISettings();
  }

  public setAIKey(apiKey: string) {
    return this.aiModule.setAIKey(apiKey);
  }

  public clearAIKey() {
    return this.aiModule.clearAIKey();
  }

  public getProxySettings(): ProxySettings {
    return this.aiModule.getProxySettings();
  }

  public setProxySettings(settings: ProxySettingsInput): ProxySettings {
    return this.aiModule.setProxySettings(settings);
  }

  public async testAIConnection(apiKey?: string) {
    return this.aiModule.testAIConnection(apiKey);
  }

  public async aiTranslateFile(
    fileId: number,
    options?: {
      model?: string;
      mode?: AIBatchMode;
      targetScope?: AIBatchTargetScope;
      onProgress?: (data: { current: number; total: number; message?: string }) => void;
    },
  ) {
    return this.aiModule.aiTranslateFile(fileId, options);
  }

  public async aiTranslateSegment(
    segmentId: string,
    options?: {
      model?: string;
    },
  ) {
    return this.aiModule.aiTranslateSegment(segmentId, options);
  }

  public async aiRefineSegment(
    segmentId: string,
    instruction: string,
    options?: {
      model?: string;
    },
  ) {
    return this.aiModule.aiRefineSegment(segmentId, instruction, options);
  }

  public async aiTestTranslate(projectId: number, sourceText: string, contextText?: string) {
    return this.aiModule.aiTestTranslate(projectId, sourceText, contextText);
  }
}
