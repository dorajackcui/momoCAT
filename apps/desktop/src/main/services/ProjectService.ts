import { Segment, SegmentStatus, Token } from '@cat/core/models';
import type {
  FileQaReport,
  ProjectAIModel,
  ProjectQASettings,
  ProjectType,
} from '@cat/core/project';
import { CATDatabase } from '@cat/db';
import { LocalizationEngine, type CancellationToken } from '@cat/localization';
import { SpreadsheetFilter } from '../filters/SpreadsheetFilter';
import { TMService } from './TMService';
import { SegmentService, type WorkingTMUpdatedPayload } from './SegmentService';
import { TBService } from './TBService';
import { SegmentsUpdatedPayload, SpreadsheetPreviewData } from './ports';
import { AIProviderTransport } from './providers/AIProviderTransport';
import { ProjectFileModule } from './modules/ProjectFileModule';
import type { FileOperationProgressEmitter } from './modules/ProjectReferenceFileOperations';
import {
  createInspectFileRunner,
  createReferenceExportRunner,
} from './modules/ProjectFileOperationRunners';
import { TMModule } from './modules/TMModule';
import { TBModule } from './modules/TBModule';
import { AIModule } from './modules/AIModule';
import { SqliteProjectRepository } from './adapters/SqliteProjectRepository';
import { SqliteSegmentRepository } from './adapters/SqliteSegmentRepository';
import { SqliteTMRepository } from './adapters/SqliteTMRepository';
import { SqliteTBRepository } from './adapters/SqliteTBRepository';
import { SqliteSettingsRepository } from './adapters/SqliteSettingsRepository';
import { SqliteTransactionManager } from './adapters/SqliteTransactionManager';
import { createSourceTerminologyPrecheckRunner } from './sourceTerminologyPrecheck/createSourceTerminologyPrecheckRunner';
import { ProxySettingsManager } from './proxy/ProxySettingsManager';
import type {
  AIBatchMode,
  AIBatchTargetBaseline,
  AIBatchTargetScope,
  FileInspectResult,
  FileReferenceExportResult,
  FileSourceTerminologyPrecheckResult,
  ImportOptions,
  PastedSourceFileInput,
  ProxySettings,
  ProxySettingsInput,
  TBImportOptions,
  TBSyncConfig,
  TBSyncConfigInput,
  TMCommitOptions,
  TMImportOptions,
  TMSyncConfig,
  TMSyncConfigInput,
  TMSyncReport,
} from '../../shared/ipc';
import type {
  AddAIProviderInput,
  AIConnectionSummary,
  AIProviderSummary,
  AITestConnectionResult,
  TestAIConnectionInput,
} from './modules/ai/AIProviderCatalogService';
import type { ProjectServiceDependencies } from './ProjectServiceDependencies';

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
    scope?: string;
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
    const aiRuntimeConfigProvider = deps.aiRuntimeConfigProvider;
    const aiTransport = deps.aiTransport ?? new AIProviderTransport();

    const emitProgress = (payload: {
      type: string;
      current: number;
      total: number;
      message?: string;
    }) => {
      this.emitProgress(payload.type, payload.current, payload.total, payload.message);
    };
    const emitFileOperationProgress: FileOperationProgressEmitter = (
      type,
      fileId,
      current,
      total,
    ) => {
      this.emitProgress(type, current, total, undefined, `file:${fileId}`);
    };

    this.projectModule =
      deps.projectModule ??
      new ProjectFileModule(
        projectRepo,
        segmentRepo,
        filter,
        projectsDir,
        deps.inspectFileRunner ??
          createInspectFileRunner(db, dbPath, aiRuntimeConfigProvider, aiTransport),
        deps.referenceExportRunner ?? createReferenceExportRunner(db, dbPath),
        deps.sourceTerminologyPrecheckRunner ??
          createSourceTerminologyPrecheckRunner(db, dbPath, aiRuntimeConfigProvider, aiTransport),
        emitFileOperationProgress,
      );
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
        settingsRepo,
      );
    this.tbModule =
      deps.tbModule ?? new TBModule(tbRepo, tx, tbService, emitProgress, settingsRepo);

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
        new LocalizationEngine(db, {
          dbPath,
          aiTransport,
          aiRuntimeConfigProvider,
          auditSink: deps.translationAuditSink,
        }),
        deps.translationAuditSink?.flush?.bind(deps.translationAuditSink),
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

  public async createPastedSourceFile(projectId: number, input: PastedSourceFileInput) {
    return this.projectModule.createPastedSourceFile(projectId, input);
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

  public async renameFile(fileId: number, name: string) {
    return this.projectModule.renameFile(fileId, name);
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
    aiProviderId: ProjectAIModel | null,
  ) {
    this.projectModule.updateProjectAISettings(projectId, aiPrompt, aiProviderId);
  }

  public updateProjectQASettings(projectId: number, qaSettings: ProjectQASettings) {
    this.projectModule.updateProjectQASettings(projectId, qaSettings);
  }

  public listProjectSavedPrompts(projectId: number) {
    return this.projectModule.listProjectSavedPrompts(projectId);
  }

  public createProjectSavedPrompt(projectId: number, name: string, content: string) {
    return this.projectModule.createProjectSavedPrompt(projectId, name, content);
  }

  public updateProjectSavedPrompt(
    projectId: number,
    promptId: number,
    name: string,
    content: string,
  ) {
    this.projectModule.updateProjectSavedPrompt(projectId, promptId, name, content);
  }

  public deleteProjectSavedPrompt(projectId: number, promptId: number) {
    this.projectModule.deleteProjectSavedPrompt(projectId, promptId);
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

  public onWorkingTMUpdated(callback: (data: WorkingTMUpdatedPayload) => void) {
    this.segmentService.on('working-tm-updated', callback);
    return () => this.segmentService.off('working-tm-updated', callback);
  }

  public onProgress(
    callback: (data: {
      type: string;
      current: number;
      total: number;
      message?: string;
      scope?: string;
    }) => void,
  ) {
    this.progressCallbacks.push(callback);
    return () => {
      this.progressCallbacks = this.progressCallbacks.filter((c) => c !== callback);
    };
  }

  private emitProgress(
    type: string,
    current: number,
    total: number,
    message?: string,
    scope?: string,
  ) {
    this.progressCallbacks.forEach((cb) => cb({ type, current, total, message, scope }));
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

  public async getTMPreview(tmId: string) {
    return this.tmModule.getTMPreview(tmId);
  }

  public async createTM(
    name: string,
    srcLang: string,
    tgtLang: string,
    type: 'working' | 'main' = 'main',
  ) {
    return this.tmModule.createTM(name, srcLang, tgtLang, type);
  }

  public async renameTM(tmId: string, name: string) {
    return this.tmModule.renameTM(tmId, name);
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

  public async getTBPreview(tbId: string) {
    return this.tbModule.getTBPreview(tbId);
  }

  public async createTB(name: string, srcLang: string, tgtLang: string) {
    return this.tbModule.createTB(name, srcLang, tgtLang);
  }

  public async renameTB(tbId: string, name: string) {
    return this.tbModule.renameTB(tbId, name);
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

  public getTMSyncConfig(tmId: string): TMSyncConfig | null {
    return this.tmModule.getTMSyncConfig(tmId);
  }

  public async setTMSyncConfig(tmId: string, config: TMSyncConfigInput): Promise<void> {
    return this.tmModule.setTMSyncConfig(tmId, config);
  }

  public async syncTMEntriesFromExcel(
    tmId: string,
    onProgress?: (progress: ImportProgress) => void,
  ): Promise<TMSyncReport> {
    return this.tmModule.syncTMEntriesFromExcel(tmId, onProgress);
  }

  public cancelTMSync(tmId: string): boolean {
    return this.tmModule.cancelTMSync(tmId);
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

  public getTBSyncConfig(tbId: string): TBSyncConfig | null {
    return this.tbModule.getTBSyncConfig(tbId);
  }

  public async setTBSyncConfig(tbId: string, config: TBSyncConfigInput): Promise<void> {
    return this.tbModule.setTBSyncConfig(tbId, config);
  }

  public async syncTBEntriesFromExcel(
    tbId: string,
    onProgress?: (progress: ImportProgress) => void,
  ): Promise<{ success: number; skipped: number; removed: number }> {
    return this.tbModule.syncTBEntriesFromExcel(tbId, onProgress);
  }

  public async commitToMainTM(tmId: string, fileId: number, options?: TMCommitOptions) {
    return this.tmModule.commitToMainTM(tmId, fileId, options);
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

  public async inspectFile(fileId: number, outputPath: string): Promise<FileInspectResult> {
    return this.projectModule.inspectFile(fileId, outputPath);
  }

  public async exportReferencesForMt(
    fileId: number,
    outputPath: string,
  ): Promise<FileReferenceExportResult> {
    return this.projectModule.exportReferencesForMt(fileId, outputPath);
  }

  public async precheckSourceTerminology(
    fileId: number,
    outputPath: string,
  ): Promise<FileSourceTerminologyPrecheckResult> {
    return this.projectModule.precheckSourceTerminology(fileId, outputPath);
  }
  public cancelSourceTerminologyPrecheck(fileId: number): boolean {
    return this.projectModule.cancelSourceTerminologyPrecheck(fileId);
  }

  public getAISettings(): { apiKeySet: boolean; apiKeyLast4?: string } {
    return this.aiModule.getAISettings();
  }

  public listAIProviders(): AIProviderSummary[] {
    return this.aiModule.listAIProviders();
  }

  public listAIConnections(): AIConnectionSummary[] {
    return this.aiModule.listAIConnections();
  }

  public async testAIConnection(input: TestAIConnectionInput): Promise<AITestConnectionResult> {
    return this.aiModule.testAIConnection(input);
  }

  public async addAIProvider(input: AddAIProviderInput): Promise<AIProviderSummary> {
    return this.aiModule.addAIProvider(input);
  }

  public deleteAIProvider(providerId: string) {
    return this.aiModule.deleteAIProvider(providerId);
  }

  public deleteAIConnection(connectionId: string) {
    return this.aiModule.deleteAIConnection(connectionId);
  }

  public getProxySettings(): ProxySettings {
    return this.aiModule.getProxySettings();
  }

  public setProxySettings(settings: ProxySettingsInput): ProxySettings {
    return this.aiModule.setProxySettings(settings);
  }

  public async aiTranslateFile(
    fileId: number,
    options?: {
      model?: string;
      mode?: AIBatchMode;
      targetScope?: AIBatchTargetScope;
      targetBaseline?: AIBatchTargetBaseline;
      onProgress?: (data: { current: number; total: number; message?: string }) => void;
      cancellationToken?: CancellationToken;
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
