import type { Segment } from '@cat/core/models';
import type {
  ProgressEmitter,
  ProjectRepository,
  SegmentRepository,
  SpreadsheetPreviewData,
  TMConcordanceRecord,
  TMRepository,
  TransactionManager,
} from '../ports';
import { TMService } from '../TMService';
import { SegmentService } from '../SegmentService';
import type { TMImportOptions } from '../../../shared/ipc';
import { TMImportService } from './tm/TMImportService';
import { TMBatchOpsService } from './tm/TMBatchOpsService';
import { TMQueryService } from './tm/TMQueryService';
import type { ImportProgress, ImportProgressCallback } from './tm/types';

export type { ImportProgress };

export class TMModule {
  private readonly queryService: TMQueryService;
  private readonly importService: TMImportService;
  private readonly batchOpsService: TMBatchOpsService;

  constructor(
    projectRepo: ProjectRepository,
    segmentRepo: SegmentRepository,
    tmRepo: TMRepository,
    tx: TransactionManager,
    tmService: TMService,
    segmentService: SegmentService,
    dbPath: string,
    emitProgress: ProgressEmitter,
  ) {
    this.queryService = new TMQueryService(tmRepo, tmService);
    this.importService = new TMImportService(tmRepo, tx, dbPath, emitProgress);
    this.batchOpsService = new TMBatchOpsService(projectRepo, segmentRepo, tmRepo, segmentService);
  }

  public async findMatches(projectId: number, segment: Segment) {
    return this.queryService.findMatches(projectId, segment);
  }

  public async searchConcordance(projectId: number, query: string): Promise<TMConcordanceRecord[]> {
    return this.queryService.searchConcordance(projectId, query);
  }

  public async listTMs(type?: 'working' | 'main') {
    return this.queryService.listTMs(type);
  }

  public async createTM(
    name: string,
    srcLang: string,
    tgtLang: string,
    type: 'working' | 'main' = 'main',
  ) {
    return this.queryService.createTM(name, srcLang, tgtLang, type);
  }

  public async deleteTM(tmId: string) {
    return this.queryService.deleteTM(tmId);
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

  public async getTMImportPreview(filePath: string): Promise<SpreadsheetPreviewData> {
    return this.importService.getTMImportPreview(filePath);
  }

  public async importTMEntries(
    tmId: string,
    filePath: string,
    options: TMImportOptions,
    onProgress?: ImportProgressCallback,
  ): Promise<{ success: number; skipped: number }> {
    return this.importService.importTMEntries(tmId, filePath, options, onProgress);
  }

  public async commitToMainTM(tmId: string, fileId: number) {
    return this.batchOpsService.commitToMainTM(tmId, fileId);
  }

  public async batchMatchFileWithTM(
    fileId: number,
    tmId: string,
  ): Promise<{ total: number; matched: number; applied: number; skipped: number }> {
    return this.batchOpsService.batchMatchFileWithTM(fileId, tmId);
  }
}
