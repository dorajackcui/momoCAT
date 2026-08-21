import type { Segment } from '@cat/core/models';
import type {
  ProgressEmitter,
  ProjectRepository,
  SegmentRepository,
  SettingsRepository,
  SpreadsheetPreviewData,
  TMConcordanceRecord,
  TMRepository,
  TransactionManager,
} from '../ports';
import { TMService } from '../TMService';
import { SegmentService } from '../SegmentService';
import type {
  TMCommitOptions,
  TMImportOptions,
  TMSyncConfig,
  TMSyncConfigInput,
  TMSyncReport,
} from '../../../shared/ipc';
import { TMImportService } from './tm/TMImportService';
import { TMBatchOpsService } from './tm/TMBatchOpsService';
import { TMQueryService } from './tm/TMQueryService';
import { TMSyncService } from './tm/TMSyncService';
import { WorkingTMExportWorkerRunner } from './tm/WorkingTMExportWorkerRunner';
import { WorkingTMService } from './tm/WorkingTMService';
import { WorkingTMResetWorkerRunner } from './tm/WorkingTMResetWorkerRunner';
import type { ImportProgress, ImportProgressCallback } from './tm/types';

export type { ImportProgress };

export class TMModule {
  private readonly queryService: TMQueryService;
  private readonly importService: TMImportService;
  private readonly batchOpsService: TMBatchOpsService;
  private readonly syncService: TMSyncService;
  private readonly workingTMService: WorkingTMService;
  private readonly activeEntryMutations = new Map<string, string>();

  constructor(
    projectRepo: ProjectRepository,
    segmentRepo: SegmentRepository,
    tmRepo: TMRepository,
    tx: TransactionManager,
    tmService: TMService,
    segmentService: SegmentService,
    dbPath: string,
    emitProgress: ProgressEmitter,
    settingsRepo: SettingsRepository,
  ) {
    this.queryService = new TMQueryService(tmRepo, tmService);
    this.importService = new TMImportService(tmRepo, tx, dbPath, emitProgress);
    this.batchOpsService = new TMBatchOpsService(
      projectRepo,
      segmentRepo,
      tmRepo,
      tx,
      segmentService,
    );
    this.syncService = new TMSyncService(tmRepo, settingsRepo, dbPath, emitProgress);
    this.workingTMService = new WorkingTMService(
      tmRepo,
      new WorkingTMExportWorkerRunner({ dbPath }),
      new WorkingTMResetWorkerRunner({ dbPath }),
    );
  }

  public async findMatches(projectId: number, segment: Segment) {
    return this.queryService.findMatches(projectId, segment);
  }

  public async searchConcordance(projectId: number, query: string): Promise<TMConcordanceRecord[]> {
    return this.queryService.searchConcordance(projectId, query);
  }

  public async listTMs(type?: 'working' | 'main') {
    const tms = await this.queryService.listTMs(type);
    return tms.map((tm) => ({
      ...tm,
      syncConfig: this.syncService.getTMSyncConfig(tm.id),
    }));
  }

  public async listTMOptions(type?: 'working' | 'main') {
    return this.queryService.listTMOptions(type);
  }

  public async getTMPreview(tmId: string) {
    return this.queryService.getTMPreview(tmId);
  }

  public async createTM(
    name: string,
    srcLang: string,
    tgtLang: string,
    type: 'working' | 'main' = 'main',
  ) {
    return this.queryService.createTM(name, srcLang, tgtLang, type);
  }

  public async renameTM(tmId: string, name: string): Promise<void> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('TM name cannot be empty.');
    }
    return this.queryService.renameTM(tmId, trimmedName);
  }

  public async deleteTM(tmId: string) {
    return this.runEntryMutation(tmId, 'delete', async () => {
      await this.queryService.deleteTM(tmId);
      this.syncService.clearTMSyncConfig(tmId);
    });
  }

  public async getProjectMountedTMs(projectId: number) {
    return this.queryService.getProjectMountedTMs(projectId);
  }

  public async mountTMToProject(
    projectId: number,
    tmId: string,
    priority?: number,
    permission?: string,
  ) {
    return this.queryService.mountTMToProject(projectId, tmId, priority, permission);
  }

  public async unmountTMFromProject(projectId: number, tmId: string) {
    return this.queryService.unmountTMFromProject(projectId, tmId);
  }

  public async exportWorkingTM(projectId: number, tmId: string, outputPath: string) {
    return this.workingTMService.exportToExcel(projectId, tmId, outputPath);
  }

  public async resetWorkingTM(projectId: number, tmId: string) {
    return this.workingTMService.reset(projectId, tmId);
  }

  public async getTMImportPreview(filePath: string): Promise<SpreadsheetPreviewData> {
    return this.importService.getTMImportPreview(filePath);
  }

  public async importTMEntries(
    tmId: string,
    filePath: string,
    options: TMImportOptions,
    onProgress?: ImportProgressCallback,
  ): Promise<{ success: number; skipped: number }> {
    return this.runEntryMutation(tmId, 'import', () =>
      this.importService.importTMEntries(tmId, filePath, options, onProgress),
    );
  }

  public getTMSyncConfig(tmId: string): TMSyncConfig | null {
    return this.syncService.getTMSyncConfig(tmId);
  }

  public async setTMSyncConfig(tmId: string, config: TMSyncConfigInput): Promise<void> {
    return this.runEntryMutation(tmId, 'sync mapping update', () =>
      this.syncService.setTMSyncConfig(tmId, config),
    );
  }

  public async syncTMEntriesFromExcel(
    tmId: string,
    onProgress?: ImportProgressCallback,
  ): Promise<TMSyncReport> {
    return this.runEntryMutation(tmId, 'sync', () =>
      this.syncService.syncTMEntriesFromExcel(tmId, onProgress),
    );
  }

  public cancelTMSync(tmId: string): boolean {
    return this.syncService.cancelSync(tmId);
  }

  public async commitToMainTM(tmId: string, fileId: number, options?: TMCommitOptions) {
    return this.runEntryMutation(tmId, 'file commit', () =>
      this.batchOpsService.commitToMainTM(tmId, fileId, options),
    );
  }

  public async commitFileToTM(tmId: string, fileId: number, options?: TMCommitOptions) {
    return this.runEntryMutation(tmId, 'file commit', () =>
      this.batchOpsService.commitFileToTM(tmId, fileId, options),
    );
  }

  public async batchMatchFileWithTM(
    fileId: number,
    tmId: string,
  ): Promise<{ total: number; matched: number; applied: number; skipped: number }> {
    return this.batchOpsService.batchMatchFileWithTM(fileId, tmId);
  }

  private async runEntryMutation<T>(
    tmId: string,
    operation: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const activeOperation = this.activeEntryMutations.get(tmId);
    if (activeOperation) {
      throw new Error(
        `Cannot start TM ${operation} while ${activeOperation} is running for this TM.`,
      );
    }
    this.activeEntryMutations.set(tmId, operation);
    try {
      return await task();
    } finally {
      this.activeEntryMutations.delete(tmId);
    }
  }
}
