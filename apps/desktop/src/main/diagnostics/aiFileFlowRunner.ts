import path from 'path';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { Segment, TBMatch } from '@cat/core/models';
import type { ProjectType } from '@cat/core/project';
import { CATDatabase } from '../../../../../packages/db/src';
import { findHeaderColumn, resolveDefaultContextColumn } from '../../shared/importColumnDefaults';
import type { AIBatchMode, AIBatchTargetScope, ImportOptions } from '../../shared/ipc';
import { ProjectService } from '../services/ProjectService';
import type { AIRuntimeConfigProvider, AITransport, SpreadsheetGateway } from '../services/ports';
import type { TMMatch } from '../services/TMService';

type AIFileFlowEvent =
  | AIFileFlowStartEvent
  | AIFileFlowImportedFileEvent
  | AIFileFlowResourcesEvent
  | AIFileFlowReferencePreviewEvent
  | AIFileFlowProgressEvent
  | AIFileFlowCompleteEvent;

interface AIFileFlowStartEvent {
  event: 'ai_file_flow_start';
  projectId: number;
  projectName: string;
  fileId: number;
  fileName: string;
  mode?: AIBatchMode;
  model?: string;
  targetScope?: AIBatchTargetScope;
}

interface AIFileFlowImportedFileEvent {
  event: 'ai_file_flow_imported_file';
  projectId: number;
  fileId: number;
  fileName: string;
  sourcePath: string;
  totalSegments: number;
}

interface AIFileFlowResourcesEvent {
  event: 'ai_file_flow_resources';
  mountedTMs: Array<{
    id: string;
    name: string;
    type: string;
    priority: number;
    permission: string;
    isEnabled: boolean;
  }>;
  mountedTBs: Array<{
    id: string;
    name: string;
    priority: number;
    isEnabled: boolean;
  }>;
}

interface AIFileFlowReferencePreviewEvent {
  event: 'ai_file_flow_reference_preview';
  segmentId: string;
  orderIndex: number;
  sourcePreview: string;
  tmMatchCount: number;
  tbMatchCount: number;
  tmMatches: Array<{
    kind: TMMatch['kind'];
    rank: number;
    tmName: string;
    sourcePreview: string;
    targetPreview: string;
  }>;
  tbMatches: Array<{
    tbName: string;
    srcTerm: string;
    tgtTerm: string;
  }>;
}

interface AIFileFlowProgressEvent {
  event: 'ai_file_flow_progress';
  current: number;
  total: number;
  message?: string;
}

interface AIFileFlowCompleteEvent {
  event: 'ai_file_flow_complete';
  translation: AIFileFlowTranslationResult;
}

interface AIFileFlowTranslationResult {
  translated: number;
  skipped: number;
  failed: number;
  total: number;
}

export interface RunAIFileFlowTraceOptions {
  dbPath: string;
  projectId?: number;
  projectName?: string;
  fileId?: number;
  filePath?: string;
  importOptions?: ImportOptions;
  projectsDir?: string;
  model?: string;
  mode?: AIBatchMode;
  targetScope?: AIBatchTargetScope;
  previewLimit?: number;
  emit?: (event: AIFileFlowEvent) => void;
  db?: CATDatabase;
  aiTransport?: AITransport;
  aiRuntimeConfigProvider?: AIRuntimeConfigProvider;
  filter?: SpreadsheetGateway;
}

export interface AIFileFlowTraceResult {
  translation: AIFileFlowTranslationResult;
}

const DEFAULT_PREVIEW_LIMIT = 3;
const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  hasHeader: true,
  sourceCol: 0,
  targetCol: 1,
};

export async function runAIFileFlowTrace(
  options: RunAIFileFlowTraceOptions,
): Promise<AIFileFlowTraceResult> {
  const db = options.db ?? new CATDatabase(options.dbPath);
  const shouldCloseDb = !options.db;

  try {
    const projectService = new ProjectService(
      db,
      options.projectsDir ?? defaultProjectsDir(options.dbPath),
      options.dbPath,
      {
        aiTransport: options.aiTransport,
        aiRuntimeConfigProvider: options.aiRuntimeConfigProvider,
        filter: options.filter,
      },
    );

    const project = resolveProject(projectService, options);
    const file = await resolveFile(
      projectService,
      project.id,
      project.projectType ?? 'translation',
      options,
    );

    emit(options, {
      event: 'ai_file_flow_start',
      projectId: project.id,
      projectName: project.name,
      fileId: file.id,
      fileName: file.name,
      mode: options.mode,
      model: options.model,
      targetScope: options.targetScope,
    });

    const [mountedTMs, mountedTBs] = await Promise.all([
      projectService.getProjectMountedTMs(project.id),
      projectService.getProjectMountedTBs(project.id),
    ]);
    emit(options, {
      event: 'ai_file_flow_resources',
      mountedTMs: mountedTMs.map((tm) => ({
        id: tm.id,
        name: tm.name,
        type: tm.type,
        priority: tm.priority,
        permission: tm.permission,
        isEnabled: Boolean(tm.isEnabled),
      })),
      mountedTBs: mountedTBs.map((tb) => ({
        id: tb.id,
        name: tb.name,
        priority: tb.priority,
        isEnabled: Boolean(tb.isEnabled),
      })),
    });

    await emitReferencePreview(options, projectService, project.id, file.id);

    const translation = await projectService.aiTranslateFile(file.id, {
      model: options.model,
      mode: options.mode,
      targetScope: options.targetScope,
      onProgress: (progress) =>
        emit(options, {
          event: 'ai_file_flow_progress',
          current: progress.current,
          total: progress.total,
          message: progress.message,
        }),
    });

    emit(options, {
      event: 'ai_file_flow_complete',
      translation,
    });

    return { translation };
  } finally {
    if (shouldCloseDb) {
      db.close();
    }
  }
}

function resolveProject(projectService: ProjectService, options: RunAIFileFlowTraceOptions) {
  if (options.projectId !== undefined) {
    const project = projectService.getProject(options.projectId);
    if (!project) {
      throw new Error(`Project not found: ${options.projectId}`);
    }
    return project;
  }

  const projectName = options.projectName?.trim();
  if (!projectName) {
    throw new Error('Missing project id or project name.');
  }

  const matches = projectService.listProjects().filter((project) => project.name === projectName);
  if (matches.length === 0) {
    throw new Error(`Project not found by name: ${projectName}`);
  }
  if (matches.length > 1) {
    throw new Error(`Project name is ambiguous: ${projectName}`);
  }
  return matches[0];
}

async function resolveFile(
  projectService: ProjectService,
  projectId: number,
  projectType: ProjectType,
  options: RunAIFileFlowTraceOptions,
) {
  if (options.fileId !== undefined) {
    const file = projectService.getFile(options.fileId);
    if (!file) {
      throw new Error(`File not found: ${options.fileId}`);
    }
    if (file.projectId !== projectId) {
      throw new Error(
        `File ${options.fileId} belongs to project ${file.projectId}, not project ${projectId}`,
      );
    }
    return file;
  }

  const filePath = options.filePath?.trim();
  if (!filePath) {
    throw new Error('Missing file id or file path.');
  }

  const importOptions = await resolveImportOptions(
    projectService,
    filePath,
    projectType,
    options.importOptions,
  );
  const file = await projectService.addFileToProject(projectId, filePath, importOptions);
  emit(options, {
    event: 'ai_file_flow_imported_file',
    projectId,
    fileId: file.id,
    fileName: file.name,
    sourcePath: filePath,
    totalSegments: file.totalSegments,
  });
  return file;
}

async function resolveImportOptions(
  projectService: ProjectService,
  filePath: string,
  projectType: ProjectType,
  importOptions: ImportOptions | undefined,
): Promise<ImportOptions> {
  if (importOptions) {
    return importOptions;
  }

  const preview = await projectService.getSpreadsheetPreview(filePath);
  const headerRow = preview[0] ?? [];
  const sourceCol = findHeaderColumn(headerRow, 'source');
  const targetCol = findHeaderColumn(headerRow, 'target');
  if (sourceCol === undefined || targetCol === undefined) {
    const headers = headerRow.map((cell) => String(cell ?? '').trim()).join(', ');
    throw new Error(
      `Could not auto-detect import columns. Expected header columns "source" and "target"; found: ${headers}`,
    );
  }
  if (sourceCol === targetCol) {
    throw new Error('Auto-detected source and target columns are the same column.');
  }

  const contextCol = resolveDefaultContextColumn({
    hasHeader: true,
    previewData: preview,
    projectType,
    sourceCol,
  });
  const resolvedOptions: ImportOptions = {
    ...DEFAULT_IMPORT_OPTIONS,
    hasHeader: true,
    sourceCol,
    targetCol,
  };

  if (contextCol !== undefined) {
    resolvedOptions.contextCol = contextCol;
  }

  return resolvedOptions;
}

async function emitReferencePreview(
  options: RunAIFileFlowTraceOptions,
  projectService: ProjectService,
  projectId: number,
  fileId: number,
): Promise<void> {
  const limit = normalizePreviewLimit(options.previewLimit);
  if (limit === 0) return;

  let emitted = 0;
  let offset = 0;
  while (emitted < limit) {
    const page = projectService.getSegments(fileId, offset, limit - emitted);
    if (page.length === 0) return;

    for (const segment of page) {
      const [tmMatches, tbMatches] = await Promise.all([
        projectService.findMatches(projectId, segment),
        projectService.findTermMatches(projectId, segment),
      ]);

      emit(options, {
        event: 'ai_file_flow_reference_preview',
        segmentId: segment.segmentId,
        orderIndex: segment.orderIndex,
        sourcePreview: previewSegmentSource(segment),
        tmMatchCount: tmMatches.length,
        tbMatchCount: tbMatches.length,
        tmMatches: tmMatches.slice(0, 3).map(summarizeTMMatch),
        tbMatches: tbMatches.slice(0, 5).map(summarizeTBMatch),
      });
      emitted += 1;
      if (emitted >= limit) return;
    }

    offset += page.length;
  }
}

function emit(options: RunAIFileFlowTraceOptions, event: AIFileFlowEvent): void {
  options.emit?.(event);
}

function normalizePreviewLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PREVIEW_LIMIT;
  if (!Number.isFinite(value)) return DEFAULT_PREVIEW_LIMIT;
  return Math.max(0, Math.floor(value));
}

function summarizeTMMatch(match: TMMatch) {
  return {
    kind: match.kind,
    rank: match.rank,
    tmName: match.tmName,
    sourcePreview: previewText(serializeTokensToDisplayText(match.sourceTokens)),
    targetPreview: previewText(serializeTokensToDisplayText(match.targetTokens)),
  };
}

function summarizeTBMatch(match: TBMatch) {
  return {
    tbName: match.tbName,
    srcTerm: match.srcTerm,
    tgtTerm: match.tgtTerm,
  };
}

function previewSegmentSource(segment: Segment): string {
  return previewText(serializeTokensToDisplayText(segment.sourceTokens));
}

function previewText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 160);
}

function defaultProjectsDir(dbPath: string): string {
  if (dbPath === ':memory:') {
    return path.resolve(process.cwd(), '.tmp', 'desktop-ai-trace-projects');
  }
  return path.join(path.dirname(path.resolve(dbPath)), 'projects');
}
