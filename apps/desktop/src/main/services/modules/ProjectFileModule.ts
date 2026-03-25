import { basename, join } from 'path';
import { copyFile, mkdir, rm, unlink } from 'fs/promises';
import { type Segment, type TBMatch } from '@cat/core/models';
import {
  DEFAULT_PROJECT_QA_SETTINGS,
  type FileQaReport,
  type ProjectAIModel,
  type ProjectQASettings,
  type ProjectType,
} from '@cat/core/project';
import { evaluateSegmentQa, validateSegmentTags } from '@cat/core/qa';
import {
  ImportOptions,
  ProjectRepository,
  SegmentRepository,
  SpreadsheetGateway,
  SpreadsheetPreviewData,
} from '../ports';

export class ProjectFileModule {
  private static readonly SEGMENT_PAGE_SIZE = 2000;

  constructor(
    private readonly projectRepo: ProjectRepository,
    private readonly segmentRepo: SegmentRepository,
    private readonly filter: SpreadsheetGateway,
    private readonly projectsDir: string,
  ) {}

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
    aiTemperature: number | null,
    aiModel: ProjectAIModel | null,
  ) {
    this.projectRepo.updateProjectAISettings(projectId, aiPrompt, aiTemperature, aiModel);
  }

  public updateProjectQASettings(projectId: number, qaSettings: ProjectQASettings) {
    this.projectRepo.updateProjectQASettings(projectId, qaSettings);
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
      storedPath = join(projectDir, `${fileId}_${fileName}`);
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

  public listFiles(projectId: number) {
    return this.projectRepo.listFiles(projectId);
  }

  public getFile(fileId: number) {
    return this.projectRepo.getFile(fileId);
  }

  public async deleteFile(fileId: number) {
    const file = this.projectRepo.getFile(fileId);
    if (!file) return;

    this.projectRepo.deleteFile(fileId);

    const filePath = join(this.projectsDir, file.projectId.toString(), `${file.id}_${file.name}`);
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

  public async exportFile(
    fileId: number,
    outputPath: string,
    options?: ImportOptions,
    forceExport: boolean = false,
  ) {
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
    const errors: { row: number; message: string }[] = [];

    for (const seg of segments) {
      const issues = validateSegmentTags(seg);
      const criticalErrors = issues.filter((i) => i.severity === 'error');
      if (criticalErrors.length > 0) {
        errors.push({
          row: seg.meta.rowRef || 0,
          message: criticalErrors.map((e) => e.message).join('; '),
        });
      }
    }

    if (errors.length > 0 && !forceExport) {
      const errorMsg = errors
        .slice(0, 5)
        .map((e) => `Row ${e.row}: ${e.message}`)
        .join('\n');
      const error = new Error(
        `Export blocked by QA errors:\n${errorMsg}${errors.length > 5 ? `\n...and ${errors.length - 5} more.` : ''}`,
      );
      Object.assign(error, { qaErrors: errors });
      throw error;
    }

    const storedPath = join(this.projectsDir, file.projectId.toString(), `${file.id}_${file.name}`);
    await this.filter.export(storedPath, segments, finalOptions, outputPath);
  }

  public async runFileQA(
    fileId: number,
    resolveTermMatches: (projectId: number, segment: Segment) => Promise<TBMatch[]>,
  ): Promise<FileQaReport> {
    const file = this.projectRepo.getFile(fileId);
    if (!file) {
      throw new Error('File not found');
    }

    const project = this.projectRepo.getProject(file.projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const qaSettings = project.qaSettings || DEFAULT_PROJECT_QA_SETTINGS;
    const enabledRuleIds = qaSettings.enabledRuleIds || [];
    const issues: FileQaReport['issues'] = [];
    let checkedSegments = 0;
    let errorCount = 0;
    let warningCount = 0;
    let offset = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const page = this.segmentRepo.getSegmentsPage(fileId, offset, pageSize);
      if (page.length === 0) break;
      offset += page.length;
      hasMore = page.length === pageSize;

      for (const segment of page) {
        checkedSegments += 1;
        const termMatches = enabledRuleIds.includes('terminology-consistency')
          ? await resolveTermMatches(project.id, segment)
          : [];
        const segmentIssues = evaluateSegmentQa(segment, {
          enabledRuleIds,
          termMatches,
          targetLocale: project.tgtLang,
        });
        this.segmentRepo.updateSegmentQaIssues(segment.segmentId, segmentIssues);

        for (const issue of segmentIssues) {
          if (issue.severity === 'error') errorCount += 1;
          if (issue.severity === 'warning') warningCount += 1;
          issues.push({
            segmentId: segment.segmentId,
            row: segment.meta.rowRef || segment.orderIndex + 1,
            ruleId: issue.ruleId,
            severity: issue.severity,
            message: issue.message,
          });
        }
      }
    }

    return {
      fileId,
      checkedSegments,
      errorCount,
      warningCount,
      issues,
    };
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
