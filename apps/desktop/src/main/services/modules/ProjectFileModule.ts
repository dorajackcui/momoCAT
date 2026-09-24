import { basename, join } from 'path';
import { copyFile, mkdir, rename, rm, unlink, writeFile } from 'fs/promises';
import { type Segment, type TBMatch } from '@cat/core/models';
import { normalizeProjectFileName } from '@cat/db';
import {
  type FileQaReport,
  type ProjectAIModel,
  type ProjectQASettings,
  type ProjectType,
} from '@cat/core/project';
import { runProjectFileQA, runProjectSegmentQA, type RunQAInput } from '@cat/localization';
import type { TransactionManager } from '../ports';
import {
  ImportOptions,
  ProjectRepository,
  SegmentRepository,
  SpreadsheetGateway,
  SpreadsheetPreviewData,
} from '../ports';
import type {
  FileInspectResult,
  FileReferenceExportResult,
  FileSourceTerminologyPrecheckResult,
  PastedSourceFileInput,
  ProjectFileRenameResult,
} from '../../../shared/ipc';
import {
  buildPastedSourceCsv,
  buildPastedSourceFileName,
  normalizePastedSources,
} from './pastedSourceFile';
import {
  ProjectReferenceFileOperations,
  type FileOperationProgressEmitter,
  type InspectFileRunner,
  type ReferenceExportRunner,
  type SourceTerminologyPrecheckRunner,
} from './ProjectReferenceFileOperations';
import { internalProjectFilePath } from './projectFileStorage';

export class ProjectFileModule {
  private readonly qaInvalidationListeners = new Set<(projectId: number) => void>();
  public onQAInvalidated(callback: (projectId: number) => void) {
    this.qaInvalidationListeners.add(callback);
    return () => {
      this.qaInvalidationListeners.delete(callback);
    };
  }
  private static readonly SEGMENT_PAGE_SIZE = 2000;
  private readonly referenceOperations: ProjectReferenceFileOperations;

  constructor(
    private readonly projectRepo: ProjectRepository,
    private readonly segmentRepo: SegmentRepository,
    private readonly filter: SpreadsheetGateway,
    private readonly projectsDir: string,
    inspectFileRunner?: InspectFileRunner,
    referenceExportRunner?: ReferenceExportRunner,
    sourceTerminologyPrecheckRunner?: SourceTerminologyPrecheckRunner,
    emitFileOperationProgress?: FileOperationProgressEmitter,
    private readonly qaEvaluator?: RunQAInput['evaluate'],
    private readonly qaTransaction?: TransactionManager,
    private readonly qaFileRunner?: (fileId: number) => Promise<FileQaReport>,
    private readonly qaRevision?: () => string,
  ) {
    this.referenceOperations = new ProjectReferenceFileOperations({
      projectRepo,
      segmentRepo,
      projectsDir,
      inspectFileRunner,
      referenceExportRunner,
      sourceTerminologyPrecheckRunner,
      emitProgress: emitFileOperationProgress,
    });
  }

  private async ensureDirectory(path: string) {
    await mkdir(path, { recursive: true });
  }

  private isFileNotFoundError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    );
  }

  public async createProject(
    name: string,
    srcLang: string,
    tgtLang: string,
    projectType: ProjectType = 'translation',
  ) {
    await this.ensureDirectory(this.projectsDir);
    const projectId = this.projectRepo.createProject(name, srcLang, tgtLang, projectType);

    const projectDir = join(this.projectsDir, projectId.toString());
    await this.ensureDirectory(projectDir);

    const project = this.projectRepo.getProject(projectId);
    if (!project) {
      throw new Error('Failed to retrieve created project');
    }

    return project;
  }

  public listProjects() {
    return this.projectRepo.listProjects();
  }

  public getProject(projectId: number) {
    return this.projectRepo.getProject(projectId);
  }

  public updateProjectPrompt(projectId: number, aiPrompt: string | null) {
    this.projectRepo.updateProjectPrompt(projectId, aiPrompt);
  }

  public updateProjectAISettings(
    projectId: number,
    aiPrompt: string | null,
    aiModel: ProjectAIModel | null,
  ) {
    this.projectRepo.updateProjectAISettings(projectId, aiPrompt, aiModel);
  }

  public updateProjectQASettings(projectId: number, qaSettings: ProjectQASettings) {
    this.projectRepo.updateProjectQASettings(projectId, qaSettings);
    for (const callback of this.qaInvalidationListeners) callback(projectId);
  }

  public listProjectSavedPrompts(projectId: number) {
    return this.projectRepo.listProjectSavedPrompts(projectId);
  }

  public createProjectSavedPrompt(projectId: number, name: string, content: string) {
    return this.projectRepo.createProjectSavedPrompt(projectId, name, content);
  }

  public updateProjectSavedPrompt(
    projectId: number,
    promptId: number,
    name: string,
    content: string,
  ) {
    this.projectRepo.updateProjectSavedPrompt(projectId, promptId, name, content);
  }

  public deleteProjectSavedPrompt(projectId: number, promptId: number) {
    this.projectRepo.deleteProjectSavedPrompt(projectId, promptId);
  }

  public async deleteProject(projectId: number) {
    this.projectRepo.deleteProject(projectId);

    const projectDir = join(this.projectsDir, projectId.toString());
    await rm(projectDir, { recursive: true, force: true });
  }

  public async addFileToProject(projectId: number, filePath: string, options: ImportOptions) {
    const project = this.projectRepo.getProject(projectId);
    if (!project) throw new Error('Project not found');

    const fileName = basename(filePath);
    const projectDir = join(this.projectsDir, projectId.toString());
    await this.ensureDirectory(this.projectsDir);
    await this.ensureDirectory(projectDir);

    let fileId: number | undefined;
    let storedPath: string | undefined;

    try {
      fileId = this.projectRepo.createFile(projectId, fileName, JSON.stringify(options));
      storedPath = internalProjectFilePath(this.projectsDir, {
        id: fileId,
        projectId,
        name: fileName,
      });
      await copyFile(filePath, storedPath);

      const segments = await this.filter.import(storedPath, projectId, fileId, options);
      if (segments.length === 0) {
        throw new Error('No valid segments found in the selected file.');
      }

      this.segmentRepo.bulkInsertSegments(segments);

      const file = this.projectRepo.getFile(fileId);
      if (!file) throw new Error('Failed to retrieve created file');

      return file;
    } catch (error) {
      const originalError = error instanceof Error ? error : new Error(String(error));
      const cleanupErrors: Error[] = [];

      if (fileId !== undefined) {
        try {
          this.projectRepo.deleteFile(fileId);
        } catch (cleanupError) {
          console.warn(
            '[ProjectFileModule] Failed to cleanup file record after import failure:',
            cleanupError,
          );
          cleanupErrors.push(
            cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)),
          );
        }
      }

      if (storedPath) {
        try {
          await unlink(storedPath);
        } catch (cleanupError) {
          if (!this.isFileNotFoundError(cleanupError)) {
            console.warn(
              '[ProjectFileModule] Failed to cleanup copied file after import failure:',
              cleanupError,
            );
            cleanupErrors.push(
              cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)),
            );
          }
        }
      }

      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [originalError, ...cleanupErrors],
          `[ProjectFileModule] Import failed and cleanup encountered ${cleanupErrors.length} error(s)`,
        );
      }

      throw originalError;
    }
  }

  public async createPastedSourceFile(
    projectId: number,
    input: PastedSourceFileInput,
    now: Date = new Date(),
  ) {
    const project = this.projectRepo.getProject(projectId);
    if (!project) throw new Error('Project not found');

    const sources = normalizePastedSources(input.sources);
    if (sources.length === 0) {
      throw new Error('No valid pasted source rows found.');
    }

    const options: ImportOptions = {
      hasHeader: true,
      sourceCol: 0,
      targetCol: 1,
      tagPolicy: input.tagPolicy || 'default',
    };

    const projectDir = join(this.projectsDir, projectId.toString());
    await this.ensureDirectory(this.projectsDir);
    await this.ensureDirectory(projectDir);

    const existingNames = this.projectRepo.listFiles(projectId).map((file) => file.name);
    const fileName = buildPastedSourceFileName(sources[0], now, existingNames);

    let fileId: number | undefined;
    let storedPath: string | undefined;

    try {
      fileId = this.projectRepo.createFile(projectId, fileName, JSON.stringify(options));
      storedPath = internalProjectFilePath(this.projectsDir, {
        id: fileId,
        projectId,
        name: fileName,
      });
      await writeFile(storedPath, buildPastedSourceCsv(sources), 'utf8');

      const segments = await this.filter.import(storedPath, projectId, fileId, options);
      if (segments.length === 0) {
        throw new Error('No valid segments found in the pasted source content.');
      }

      this.segmentRepo.bulkInsertSegments(segments);

      const file = this.projectRepo.getFile(fileId);
      if (!file) throw new Error('Failed to retrieve created file');

      return file;
    } catch (error) {
      const originalError = error instanceof Error ? error : new Error(String(error));
      const cleanupErrors: Error[] = [];

      if (fileId !== undefined) {
        try {
          this.projectRepo.deleteFile(fileId);
        } catch (cleanupError) {
          console.warn(
            '[ProjectFileModule] Failed to cleanup pasted file record after import failure:',
            cleanupError,
          );
          cleanupErrors.push(
            cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)),
          );
        }
      }

      if (storedPath) {
        try {
          await unlink(storedPath);
        } catch (cleanupError) {
          if (!this.isFileNotFoundError(cleanupError)) {
            console.warn(
              '[ProjectFileModule] Failed to cleanup pasted source file after import failure:',
              cleanupError,
            );
            cleanupErrors.push(
              cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)),
            );
          }
        }
      }

      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [originalError, ...cleanupErrors],
          `[ProjectFileModule] Pasted source import failed and cleanup encountered ${cleanupErrors.length} error(s)`,
        );
      }

      throw originalError;
    }
  }

  public listFiles(projectId: number) {
    return this.projectRepo.listFiles(projectId);
  }

  public getFile(fileId: number) {
    return this.projectRepo.getFile(fileId);
  }

  public async renameFile(fileId: number, name: string): Promise<ProjectFileRenameResult> {
    const file = this.projectRepo.getFile(fileId);
    if (!file) throw new Error('File not found.');

    const nextName = normalizeProjectFileName(file.name, name);
    if (nextName === file.name) {
      return { name: nextName, internalFile: 'unchanged' };
    }

    const currentPath = internalProjectFilePath(this.projectsDir, file);
    const nextPath = internalProjectFilePath(this.projectsDir, { ...file, name: nextName });
    let internalFile: ProjectFileRenameResult['internalFile'] = 'renamed';
    try {
      await rename(currentPath, nextPath);
    } catch (error) {
      if (!this.isFileNotFoundError(error)) throw error;
      internalFile = 'missing';
    }

    try {
      const persistedName = this.projectRepo.renameFileMetadata(fileId, nextName);
      return { name: persistedName, internalFile };
    } catch (error) {
      if (internalFile === 'missing') throw error;
      try {
        await rename(nextPath, currentPath);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'File rename failed and the internal file name could not be restored.',
        );
      }
      throw error;
    }
  }

  public async deleteFile(fileId: number) {
    const file = this.projectRepo.getFile(fileId);
    if (!file) return;

    this.projectRepo.deleteFile(fileId);

    const filePath = internalProjectFilePath(this.projectsDir, file);
    try {
      await unlink(filePath);
    } catch (error) {
      if (!this.isFileNotFoundError(error)) {
        throw error;
      }
    }
  }

  public async getSpreadsheetPreview(filePath: string): Promise<SpreadsheetPreviewData> {
    return this.filter.getPreview(filePath);
  }

  public async exportFile(fileId: number, outputPath: string, options?: ImportOptions) {
    const file = this.projectRepo.getFile(fileId);
    if (!file) throw new Error('File not found');

    const project = this.projectRepo.getProject(file.projectId);
    if (!project) throw new Error('Project not found');

    const finalOptions =
      options || (file.importOptionsJson ? JSON.parse(file.importOptionsJson) : null);
    if (!finalOptions) {
      throw new Error('Export options not found for this file. Please specify columns.');
    }

    const segments = this.getAllSegments(fileId);
    const storedPath = internalProjectFilePath(this.projectsDir, file);
    await this.filter.export(storedPath, segments, finalOptions, outputPath);
  }

  public async inspectFile(
    fileId: number,
    outputPath: string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<FileInspectResult> {
    return this.referenceOperations.inspectFile(fileId, outputPath, onProgress);
  }

  public async exportReferencesForMt(
    fileId: number,
    outputPath: string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<FileReferenceExportResult> {
    return this.referenceOperations.exportReferencesForMt(fileId, outputPath, onProgress);
  }

  public async precheckSourceTerminology(
    fileId: number,
    outputPath: string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<FileSourceTerminologyPrecheckResult> {
    return this.referenceOperations.precheckSourceTerminology(fileId, outputPath, onProgress);
  }

  public cancelSourceTerminologyPrecheck(fileId: number): boolean {
    return this.referenceOperations.cancelSourceTerminologyPrecheck(fileId);
  }

  public async runFileQA(
    fileId: number,
    resolveTermMatches: (projectId: number, segment: Segment) => Promise<TBMatch[]>,
  ): Promise<FileQaReport> {
    if (this.qaFileRunner) return this.qaFileRunner(fileId);
    return runProjectFileQA({
      fileId,
      projectRepo: this.projectRepo,
      segmentRepo: this.segmentRepo,
      resolveTermMatches,
      evaluate: this.qaEvaluator,
      getRevision: this.qaRevision,
      transaction: (work) =>
        this.qaTransaction ? this.qaTransaction.runInTransaction(work, 'immediate') : work(),
    });
  }

  public checkSegmentQA(
    segmentId: string,
    resolveTermMatches: (projectId: number, segment: Segment) => Promise<TBMatch[]>,
  ) {
    if (!this.qaRevision || !this.qaTransaction) throw new Error('QA persistence is unavailable');
    return runProjectSegmentQA({
      segmentId,
      projectRepo: this.projectRepo,
      segmentRepo: this.segmentRepo,
      resolveTermMatches,
      getRevision: this.qaRevision,
      transaction: (work) => this.qaTransaction!.runInTransaction(work, 'immediate'),
    });
  }
  private getAllSegments(fileId: number): Segment[] {
    const segments: Segment[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const page = this.segmentRepo.getSegmentsPage(
        fileId,
        offset,
        ProjectFileModule.SEGMENT_PAGE_SIZE,
      );
      if (page.length === 0) break;
      segments.push(...page);
      hasMore = page.length === ProjectFileModule.SEGMENT_PAGE_SIZE;
      offset += ProjectFileModule.SEGMENT_PAGE_SIZE;
    }

    return segments;
  }
}
