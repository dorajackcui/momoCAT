import { access, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type {
  ExportReferencesForMtInput,
  ExportReferencesForMtResult,
  InspectFileInput,
  InspectFileResult,
  ObservableCancellationToken,
  SourceTerminologyPrecheckFileInput,
} from '@cat/localization';
import type {
  FileInspectResult,
  FileReferenceExportResult,
  FileSourceTerminologyPrecheckResult,
  ImportOptions,
} from '../../../shared/ipc';
import {
  parseFileImportOptions,
  resolveImportOptionsTagPolicy,
} from '../../../shared/fileTagPolicy';
import { buildPastedSourceCsv } from './pastedSourceFile';
import type { ProjectRepository, SegmentRepository } from '../ports';
import type { SourceTerminologyPrecheckRunner } from '../sourceTerminologyPrecheck/types';

export type { SourceTerminologyPrecheckRunner } from '../sourceTerminologyPrecheck/types';

export type InspectFileRunner = (input: InspectFileInput) => Promise<InspectFileResult>;
export type ReferenceExportRunner = (
  input: ExportReferencesForMtInput,
) => Promise<Pick<ExportReferencesForMtResult, 'outputPath' | 'summary'>>;
export type FileOperationProgressEmitter = (
  type: 'inspect' | 'reference-export' | 'source-terminology-precheck',
  fileId: number,
  current: number,
  total: number,
) => void;

interface ProjectReferenceFileOperationsOptions {
  projectRepo: ProjectRepository;
  segmentRepo: SegmentRepository;
  projectsDir: string;
  inspectFileRunner?: InspectFileRunner;
  referenceExportRunner?: ReferenceExportRunner;
  sourceTerminologyPrecheckRunner?: SourceTerminologyPrecheckRunner;
  emitProgress?: FileOperationProgressEmitter;
}

export class ProjectReferenceFileOperations {
  private readonly activeSourceTerminologyPrechecks = new Map<
    number,
    ObservableCancellationSource
  >();

  constructor(private readonly options: ProjectReferenceFileOperationsOptions) {}

  public async inspectFile(
    fileId: number,
    outputPath: string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<FileInspectResult> {
    const runner = this.options.inspectFileRunner;
    if (!runner) throw new Error('File inspect is not configured.');
    const common = await this.resolveCommonInput(fileId, outputPath, 'Inspect options');
    const { tagPolicy, ...input } = common;
    const progress = this.resolveProgress('inspect', fileId, onProgress);

    const result = await runner({
      ...input,
      options: {
        requestMode: 'window-partial',
        targetBaseline: 'ignore-current-targets',
        tagPolicy,
      },
      ...(progress ? { onProgress: progress } : {}),
    });
    return {
      outputPath: result.outputPath,
      jsonOutputPath: result.jsonOutputPath,
      summary: {
        total: result.summary.total,
        ready: result.summary.ready,
        error: result.summary.error,
      },
    };
  }

  public async exportReferencesForMt(
    fileId: number,
    outputPath: string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<FileReferenceExportResult> {
    const runner = this.options.referenceExportRunner;
    if (!runner) throw new Error('Reference export is not configured.');
    const common = await this.resolveCommonInput(fileId, outputPath, 'Import options');
    const { tagPolicy, ...input } = common;
    const progress = this.resolveProgress('reference-export', fileId, onProgress);
    const result = await runner({
      ...input,
      options: { tagPolicy },
      ...(progress ? { onProgress: progress } : {}),
    });
    return {
      outputPath: result.outputPath,
      summary: {
        total: result.summary.total,
        ready: result.summary.ready,
        error: result.summary.error,
      },
    };
  }

  public async precheckSourceTerminology(
    fileId: number,
    outputPath: string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<FileSourceTerminologyPrecheckResult> {
    const runner = this.options.sourceTerminologyPrecheckRunner;
    if (!runner) throw new Error('Source terminology precheck is not configured.');
    if (this.activeSourceTerminologyPrechecks.has(fileId)) {
      throw new Error('A source terminology precheck is already running for this file.');
    }
    const cancellationSource = new ObservableCancellationSource();
    this.activeSourceTerminologyPrechecks.set(fileId, cancellationSource);
    const progress = this.resolveProgress('source-terminology-precheck', fileId, onProgress);
    progress?.(0, 0);
    let prepared:
      | Awaited<ReturnType<ProjectReferenceFileOperations['prepareSourceTerminologyInput']>>
      | undefined;
    try {
      prepared = await this.prepareSourceTerminologyInput(fileId, outputPath);
      const result = await runner({
        ...prepared.input,
        cancellationToken: cancellationSource,
        ...(progress ? { onProgress: progress } : {}),
      });
      return { outputPath: result.outputPath, summary: result.summary };
    } finally {
      if (this.activeSourceTerminologyPrechecks.get(fileId) === cancellationSource) {
        this.activeSourceTerminologyPrechecks.delete(fileId);
      }
      await prepared?.cleanup?.().catch((error) => {
        console.warn('[SourceTerminologyPrecheck] Failed to clean temporary source file:', error);
      });
    }
  }

  public cancelSourceTerminologyPrecheck(fileId: number): boolean {
    const cancellationSource = this.activeSourceTerminologyPrechecks.get(fileId);
    if (!cancellationSource) return false;
    cancellationSource.cancel();
    return true;
  }

  private async prepareSourceTerminologyInput(
    fileId: number,
    outputPath: string,
  ): Promise<{
    input: SourceTerminologyPrecheckFileInput;
    cleanup?: () => Promise<void>;
  }> {
    const file = this.options.projectRepo.getFile(fileId);
    if (!file) throw new Error('File not found');
    const project = this.options.projectRepo.getProject(file.projectId);
    if (!project) throw new Error('Project not found');

    const importOptions = parseFileImportOptions(file);
    const storedPath = join(
      this.options.projectsDir,
      file.projectId.toString(),
      `${file.id}_${file.name}`,
    );
    try {
      await access(storedPath);
      if (!isInspectImportOptions(importOptions)) {
        throw new Error('Import options not found for this file. Please re-import the file.');
      }
      const columns: SourceTerminologyPrecheckFileInput['columns'] = {
        hasHeader: importOptions.hasHeader,
        sourceCol: importOptions.sourceCol,
        targetCol: importOptions.targetCol,
      };
      if (typeof importOptions.contextCol === 'number')
        columns.contextCol = importOptions.contextCol;
      return {
        input: {
          projectId: project.id,
          inputPath: storedPath,
          outputPath,
          columns,
          options: { tagPolicy: resolveImportOptionsTagPolicy(importOptions) },
        },
      };
    } catch (error) {
      if (!isFileNotFoundError(error)) throw error;
    }

    const sources = this.getAllSegmentSources(fileId);
    if (sources.length === 0) {
      throw new Error('Source workbook is missing and no imported source segments are available.');
    }
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'momocat-source-terms-'));
    const temporaryInputPath = join(temporaryDirectory, 'segments.csv');
    try {
      await writeFile(temporaryInputPath, buildPastedSourceCsv(sources), 'utf8');
    } catch (error) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      throw error;
    }
    return {
      input: {
        projectId: project.id,
        inputPath: temporaryInputPath,
        outputPath,
        columns: { hasHeader: true, sourceCol: 0, targetCol: 1 },
        options: { tagPolicy: resolveImportOptionsTagPolicy(importOptions) },
      },
      cleanup: () => rm(temporaryDirectory, { recursive: true, force: true }),
    };
  }

  private getAllSegmentSources(fileId: number): string[] {
    const sources: string[] = [];
    const pageSize = 2000;
    for (let offset = 0; ; offset += pageSize) {
      const page = this.options.segmentRepo.getSegmentsPage(fileId, offset, pageSize);
      sources.push(...page.map((segment) => serializeTokensToDisplayText(segment.sourceTokens)));
      if (page.length < pageSize) return sources;
    }
  }

  private async resolveCommonInput(fileId: number, outputPath: string, label: string) {
    const file = this.options.projectRepo.getFile(fileId);
    if (!file) throw new Error('File not found');
    const project = this.options.projectRepo.getProject(file.projectId);
    if (!project) throw new Error('Project not found');

    const importOptions = parseFileImportOptions(file);
    if (!isInspectImportOptions(importOptions)) {
      throw new Error(`${label} not found for this file. Please re-import the file.`);
    }

    const inputPath = join(
      this.options.projectsDir,
      file.projectId.toString(),
      `${file.id}_${file.name}`,
    );
    try {
      await access(inputPath);
    } catch (error) {
      if (isFileNotFoundError(error)) {
        throw new Error('Source workbook not found. Please re-import the file.');
      }
      throw error;
    }

    const columns: InspectFileInput['columns'] = {
      hasHeader: importOptions.hasHeader,
      sourceCol: importOptions.sourceCol,
      targetCol: importOptions.targetCol,
    };
    if (typeof importOptions.contextCol === 'number') columns.contextCol = importOptions.contextCol;
    return {
      projectId: project.id,
      inputPath,
      outputPath,
      columns,
      tagPolicy: resolveImportOptionsTagPolicy(importOptions),
    };
  }

  private resolveProgress(
    type: Parameters<FileOperationProgressEmitter>[0],
    fileId: number,
    override?: (current: number, total: number) => void,
  ): ((current: number, total: number) => void) | undefined {
    if (override) return override;
    const emitProgress = this.options.emitProgress;
    return emitProgress
      ? (current, total) => emitProgress(type, fileId, current, total)
      : undefined;
  }
}

class ObservableCancellationSource implements ObservableCancellationToken {
  private requested = false;
  private readonly listeners = new Set<() => void>();

  public isCancellationRequested(): boolean {
    return this.requested;
  }

  public onCancellationRequested(listener: () => void): () => void {
    if (this.requested) {
      listener();
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public cancel(): void {
    if (this.requested) return;
    this.requested = true;
    for (const listener of this.listeners) listener();
    this.listeners.clear();
  }
}

function isInspectImportOptions(
  importOptions: ImportOptions | undefined,
): importOptions is ImportOptions {
  return (
    typeof importOptions?.hasHeader === 'boolean' &&
    isNonnegativeInteger(importOptions.sourceCol) &&
    isNonnegativeInteger(importOptions.targetCol) &&
    (importOptions.contextCol === undefined || isNonnegativeInteger(importOptions.contextCol))
  );
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
