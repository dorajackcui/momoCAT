import { writeFile } from 'fs/promises';
import { basename, extname, join, parse } from 'path';
import type { Segment } from '@cat/core/models';
import type { Project } from '@cat/core/project';
import { TagValidator } from '@cat/core/qa';
import type { TagPolicy } from '@cat/core/tag';
import type { CATDatabase } from '@cat/db';
import { MTModule } from './modules/MTModule';
import { TBModule } from './modules/TBModule';
import { TMModule } from './modules/TMModule';
import { TBService } from './services/TBService';
import { TMService } from './services/TMService';
import { SqliteProjectRepository } from './adapters/sqlite/SqliteProjectRepository';
import { SqliteSettingsRepository } from './adapters/sqlite/SqliteSettingsRepository';
import { SqliteTBRepository } from './adapters/sqlite/SqliteTBRepository';
import { SqliteTMRepository } from './adapters/sqlite/SqliteTMRepository';
import { DefaultAIRuntimeConfigProvider } from './providers/AIRuntimeConfigService';
import { AIProviderCatalogService } from './providers/AIProviderCatalogService';
import { AIProviderTransport } from './providers/AIProviderTransport';
import { computeSourceHash } from './job/sourceHash';
import type { JobUnit, TranslationTask } from './job/types';
import type { MTBatchCurrentUnitInput } from './modules/MTModule';
import type { AIRuntimeConfigProvider, AITransport } from './ports';
import { buildWindowModeContext } from './requestModes/shared/contextWindowBuilder';
import { unitKey } from './requestModes/shared/unitIdentity';
import { buildWindowPartialReadOnlyContextRows } from './requestModes/shared/windowPartialContextBuilder';
import type {
  FileParseRowArtifact,
  InspectArtifact,
  InspectUnitArtifact,
} from './artifacts';
import {
  buildErrorUnit,
  buildXlsxFields,
  emptyPromptArtifact,
  emptyTBArtifact,
  emptyTMArtifact,
  emptyXlsxFields,
  errorMessage,
  segmentMetadata,
  stageError,
  truncateForCell,
} from './LocalizationInspectorArtifacts';
import {
  parseExternalSpreadsheet,
  writeInspectSpreadsheet,
} from './modules/FileModule';
import { createTransientSegment } from './transientSegment';
import { resolveTagPolicy } from './tagPolicy';
import { normalizeTargetForBaseline, resolveTargetBaseline } from './targetBaseline';
import type {
  LocalizationEngineOptions,
  LocalizationMode,
  LocalizationRequestMode,
  TranslateFileInput,
} from './types';

const DEFAULT_MAX_CELL_CHARS = 30000;
const INSPECT_BATCH_SIZE = 5;

export interface InspectFileInput extends TranslateFileInput {
  jsonOutputPath?: string;
  unitLimit?: number;
  maxCellChars?: number;
}

export interface InspectFileResult {
  artifact: InspectArtifact;
  outputPath: string;
  jsonOutputPath: string;
  summary: { total: number; ready: number; error: number };
}

export interface LocalizationInspectorOptions extends LocalizationEngineOptions {
  aiTransport?: AITransport;
  aiRuntimeConfigProvider?: AIRuntimeConfigProvider;
  tmModule?: TMModule;
  tbModule?: TBModule;
  mtModule?: Pick<MTModule, 'composePrompt' | 'composeBatchPrompt'>;
}

type ProjectRecord = NonNullable<
  ReturnType<SqliteProjectRepository['getProject']>
>;
type InspectRowWithSegment = {
  row: FileParseRowArtifact;
  segment: Segment;
  sourceIndex: number;
};
type InspectReadyRow = InspectRowWithSegment & {
  unit: InspectUnitArtifact;
  unitIndex: number;
};

export class LocalizationInspector {
  private readonly projectRepo: SqliteProjectRepository;
  private readonly tmModule: TMModule;
  private readonly tbModule: TBModule;
  private readonly mtModule: Pick<MTModule, 'composePrompt' | 'composeBatchPrompt'>;
  private readonly options: LocalizationInspectorOptions;

  constructor(db: CATDatabase, options: LocalizationInspectorOptions) {
    this.options = options;
    this.projectRepo = new SqliteProjectRepository(db);

    const settingsRepo = new SqliteSettingsRepository(db);
    const tmRepo = new SqliteTMRepository(db);
    const tbRepo = new SqliteTBRepository(db);
    const tmService = new TMService(this.projectRepo, tmRepo);
    const tbService = new TBService(this.projectRepo, tbRepo);
    const aiTransport = options.aiTransport ?? new AIProviderTransport();
    const providerCatalogService = new AIProviderCatalogService(
      settingsRepo,
      aiTransport,
    );
    const aiRuntimeConfigProvider =
      options.aiRuntimeConfigProvider ?? new DefaultAIRuntimeConfigProvider();

    this.tmModule =
      options.tmModule ??
      new TMModule({
        tmRepo,
        tmService,
      });
    this.tbModule =
      options.tbModule ??
      new TBModule({
        tbRepo,
        tbService,
      });
    this.mtModule =
      options.mtModule ??
      new MTModule({
        providerCatalogService,
        aiRuntimeConfigProvider,
        aiTransport,
        tagValidator: new TagValidator(),
      });
  }

  async inspectFile(input: InspectFileInput): Promise<InspectFileResult> {
    const project = this.projectRepo.getProject(input.projectId);
    if (!project) {
      throw new Error(`Project not found: ${input.projectId}`);
    }

    const mode = this.resolveMode(input.options?.mode);
    if (mode === 'dialogue') {
      throw new Error(
        'Dialogue mode is not supported for external localization inspection.',
      );
    }

    const unitLimit = validatePositiveInteger(input.unitLimit, 'unitLimit');
    const maxCellChars =
      validatePositiveInteger(input.maxCellChars, 'maxCellChars') ??
      DEFAULT_MAX_CELL_CHARS;
    const parsed = await parseExternalSpreadsheet(input);
    const jsonOutputPath =
      input.jsonOutputPath ?? inferJsonOutputPath(input.outputPath);
    const targetBaseline = resolveTargetBaseline({
      targetBaseline: input.options?.targetBaseline,
      targetScope: input.options?.targetScope ?? this.options.defaultTargetScope,
    });
    const tagPolicy = resolveTagPolicy(input.options?.tagPolicy);
    const sourceRows = parsed.artifact.rows.filter((row) => row.source.trim());
    const baselineRows = sourceRows.map((row) => ({
      ...row,
      target: normalizeTargetForBaseline({
        target: row.target,
        targetBaseline,
      }),
    }));
    const limitedRows =
      unitLimit === undefined ? baselineRows : baselineRows.slice(0, unitLimit);

    const rowsWithSegments = limitedRows.map((row, index) => {
      const segment = createTransientSegment(
        rowToUnit(row, project, parsed.inputPath),
        index,
        {
          projectId: project.id,
          sourceLanguage: project.srcLang,
          targetLanguage: project.tgtLang,
          fileName: basename(parsed.inputPath),
        },
        { tagPolicy },
      );
      return { row, segment, sourceIndex: index };
    });

    const requestMode = this.resolveRequestMode(input.options?.requestMode);
    const units =
      requestMode === 'window-partial'
        ? await this.inspectRowsWindowPartialMode(
            project,
            rowsWithSegments,
            baselineRows,
            parsed.inputPath,
            maxCellChars,
            tagPolicy,
          )
        : await this.inspectRowsWindowMode(
            project,
            rowsWithSegments,
            baselineRows,
            parsed.inputPath,
            maxCellChars,
            tagPolicy,
          );

    const firstReadyPrompt =
      units.find((unit) => unit.status === 'ready')?.mt.systemPrompt ?? '';
    const truncatedSystemPrompt = truncateForCell(
      firstReadyPrompt,
      maxCellChars,
      '#/systemPrompt/value',
    );

    const artifact: InspectArtifact = {
      version: 1,
      generatedAt: new Date().toISOString(),
      project: {
        id: project.id,
        name: project.name,
        srcLang: project.srcLang,
        tgtLang: project.tgtLang,
        projectType: project.projectType ?? 'translation',
        promptChars: project.aiPrompt?.length ?? 0,
      },
      inputFile: parsed.artifact,
      systemPrompt: {
        value: firstReadyPrompt,
        promptChars: firstReadyPrompt.length,
        xlsxValue: truncatedSystemPrompt.value,
        truncated: truncatedSystemPrompt.truncated,
      },
      units,
    };

    await writeInspectSpreadsheet(parsed, artifact, input.outputPath);
    await writeFile(
      jsonOutputPath,
      `${JSON.stringify(artifact, null, 2)}\n`,
      'utf8',
    );

    return {
      artifact,
      outputPath: input.outputPath,
      jsonOutputPath,
      summary: {
        total: units.length,
        ready: units.filter((unit) => unit.status === 'ready').length,
        error: units.filter((unit) => unit.status === 'error').length,
      },
    };
  }

  private resolveMode(mode?: LocalizationMode): LocalizationMode {
    return mode ?? this.options.defaultMode ?? 'standard';
  }

  private resolveRequestMode(mode?: LocalizationRequestMode): LocalizationRequestMode {
    return mode ?? 'window';
  }

  private async inspectRowsWindowMode(
    project: ProjectRecord,
    rows: InspectRowWithSegment[],
    contextRows: FileParseRowArtifact[],
    inputPath: string,
    maxCellChars: number,
    tagPolicy: TagPolicy,
  ): Promise<InspectUnitArtifact[]> {
    const translatableRows = rows.filter(({ row }) => isRequestRow(row));
    const units = await Promise.all(
      translatableRows.map(({ row, segment }) =>
        this.inspectRowReferences(project, row, segment),
      ),
    );
    const readyRowByUnitId = new Map(
      translatableRows.map((rowWithSegment, unitIndex) => [
        rowWithSegment.row.unitId,
        {
          ...rowWithSegment,
          unit: units[unitIndex],
          unitIndex,
        },
      ]),
    );
    const inputDocumentId = basename(inputPath);

    for (
      let batchStart = 0;
      batchStart < rows.length;
      batchStart += INSPECT_BATCH_SIZE
    ) {
      const batchRows = rows.slice(batchStart, batchStart + INSPECT_BATCH_SIZE);
      const readyRows = batchRows
        .map((rowWithSegment) =>
          readyRowByUnitId.get(rowWithSegment.row.unitId),
        )
        .filter(
          (item): item is InspectReadyRow =>
            item !== undefined && item.unit.status === 'ready',
        );

      if (readyRows.length === 0) {
        continue;
      }

      try {
        const current: MTBatchCurrentUnitInput[] = readyRows.map(
          ({ row, segment, unit }) => ({
            responseId: row.unitId,
            documentId: inputDocumentId,
            unitId: row.unitId,
            segment,
            tm: unit.tm,
            tb: unit.tb,
            context: row.context,
          }),
        );
        const mt = await this.mtModule.composeBatchPrompt({
          taskId: `inspect-window-${Math.floor(batchStart / INSPECT_BATCH_SIZE) + 1}`,
          project,
          current,
          ...buildInspectWindowContext(contextRows, readyRows, inputDocumentId),
          mtOptions: this.options.mt,
          providerOverride: this.options.mt?.providerId,
          tagPolicy,
        });

        for (const { unitIndex } of readyRows) {
          units[unitIndex] = {
            ...units[unitIndex],
            mt,
            xlsx: buildXlsxFields(mt, unitIndex, maxCellChars),
          };
        }
      } catch (error) {
        for (const { row, segment, unitIndex } of readyRows) {
          units[unitIndex] = buildErrorUnit({
            row,
            segment,
            project,
            tm: units[unitIndex].tm,
            tb: units[unitIndex].tb,
            error: `mt: ${errorMessage(error)}`,
          });
        }
      }
    }

    return units;
  }

  private async inspectRowsWindowPartialMode(
    project: ProjectRecord,
    rows: InspectRowWithSegment[],
    contextRows: FileParseRowArtifact[],
    inputPath: string,
    maxCellChars: number,
    tagPolicy: TagPolicy,
  ): Promise<InspectUnitArtifact[]> {
    const requestRows = rows.filter(({ row }) => isRequestRow(row));
    const units = await Promise.all(
      requestRows.map(({ row, segment }) =>
        this.inspectRowReferences(project, row, segment),
      ),
    );
    const readyRowByUnitId = new Map(
      requestRows.map((rowWithSegment, unitIndex) => [
        rowWithSegment.row.unitId,
        {
          ...rowWithSegment,
          unit: units[unitIndex],
          unitIndex,
        },
      ]),
    );
    const inputDocumentId = basename(inputPath);
    const jobUnits = inspectRowsToJobUnits(contextRows, inputDocumentId);
    const jobUnitsByUnitId = new Map(jobUnits.map((unit) => [unit.unitId, unit]));

    for (
      let batchStart = 0;
      batchStart < rows.length;
      batchStart += INSPECT_BATCH_SIZE
    ) {
      const batchRows = rows.slice(batchStart, batchStart + INSPECT_BATCH_SIZE);
      const readyRows = batchRows
        .map((rowWithSegment) =>
          readyRowByUnitId.get(rowWithSegment.row.unitId),
        )
        .filter(
          (item): item is InspectReadyRow =>
            item !== undefined && item.unit.status === 'ready',
        );

      if (readyRows.length === 0) {
        continue;
      }

      try {
        const current: MTBatchCurrentUnitInput[] = readyRows.map(
          ({ row, segment, unit }) => ({
            responseId: row.unitId,
            documentId: inputDocumentId,
            unitId: row.unitId,
            segment,
            tm: unit.tm,
            tb: unit.tb,
            context: row.context,
          }),
        );
        const scanWindowUnits = batchRows.flatMap(({ row }) => {
          const unit = jobUnitsByUnitId.get(row.unitId);
          return unit ? [unit] : [];
        });
        const requestUnitKeys = readyRows.flatMap(({ row }) => {
          const unit = jobUnitsByUnitId.get(row.unitId);
          return unit ? [unitKey(unit)] : [];
        });
        const mt = await this.mtModule.composeBatchPrompt({
          taskId: `inspect-window-partial-${Math.floor(batchStart / INSPECT_BATCH_SIZE) + 1}`,
          project,
          requestMode: 'window-partial',
          current,
          previousContext: [],
          nextContext: [],
          readOnlyContextRows: buildWindowPartialReadOnlyContextRows({
            jobUnits,
            scanWindowUnits,
            requestUnitKeys,
          }),
          scanWindowCount: scanWindowUnits.length,
          mtOptions: this.options.mt,
          providerOverride: this.options.mt?.providerId,
          tagPolicy,
        });

        for (const { unitIndex } of readyRows) {
          units[unitIndex] = {
            ...units[unitIndex],
            mt,
            xlsx: buildXlsxFields(mt, unitIndex, maxCellChars),
          };
        }
      } catch (error) {
        for (const { row, segment, unitIndex } of readyRows) {
          units[unitIndex] = buildErrorUnit({
            row,
            segment,
            project,
            tm: units[unitIndex].tm,
            tb: units[unitIndex].tb,
            error: `mt: ${errorMessage(error)}`,
          });
        }
      }
    }

    return units;
  }

  private async inspectRowReferences(
    project: ProjectRecord,
    row: FileParseRowArtifact,
    segment: Segment,
  ): Promise<InspectUnitArtifact> {
    const [tmResult, tbResult] = await Promise.allSettled([
      this.tmModule.inspect(project.id, segment),
      this.tbModule.inspect(project.id, segment),
    ]);
    const tm =
      tmResult.status === 'fulfilled'
        ? tmResult.value
        : emptyTMArtifact(row.unitId, segment.segmentId);
    const tb =
      tbResult.status === 'fulfilled'
        ? tbResult.value
        : emptyTBArtifact(row.unitId, segment.segmentId);
    const referenceErrors = [
      stageError('tm', tmResult),
      stageError('tb', tbResult),
    ].filter((error): error is string => Boolean(error));

    if (referenceErrors.length > 0) {
      return buildErrorUnit({
        row,
        segment,
        project,
        tm,
        tb,
        error: referenceErrors.join('; '),
      });
    }

    return {
      unit: row,
      transientSegment: segmentMetadata(segment),
      tm,
      tb,
      mt: emptyPromptArtifact(row.unitId, project),
      xlsx: emptyXlsxFields(),
      status: 'ready',
    };
  }
}

function rowToUnit(
  row: FileParseRowArtifact,
  project: Project,
  inputPath: string,
) {
  return {
    id: row.unitId,
    source: row.source,
    target: row.target,
    sourceLanguage: project.srcLang,
    targetLanguage: project.tgtLang,
    context: row.context,
    fileName: basename(inputPath),
    rowNumber: row.rowNumber,
    metadata: {
      rowIndex: row.rowIndex,
      rowNumber: row.rowNumber,
    },
  };
}

function inspectRowsToJobUnits(
  rows: FileParseRowArtifact[],
  documentId: string,
): JobUnit[] {
  return rows
    .filter((row) => row.source.trim())
    .map((row) => ({
      documentId,
      unitId: row.unitId,
      source: row.source,
      target: row.target,
      context: row.context,
      rowNumber: row.rowNumber,
      sourceHash: computeSourceHash({
        source: row.source,
        context: row.context,
        resumeFingerprint: 'inspect',
      }),
      metadata: {
        rowIndex: row.rowIndex,
        rowNumber: row.rowNumber,
      },
    }));
}

function buildInspectWindowContext(
  rows: FileParseRowArtifact[],
  currentRows: InspectReadyRow[],
  documentId: string,
): ReturnType<typeof buildWindowModeContext> {
  const jobUnits = inspectRowsToJobUnits(rows, documentId);
  const jobUnitsByUnitId = new Map(jobUnits.map((unit) => [unit.unitId, unit]));
  const currentUnits = currentRows.flatMap((row) => {
    const unit = jobUnitsByUnitId.get(row.row.unitId);
    return unit ? [unit] : [];
  });
  const completedResults = new Map(
    jobUnits
      .filter((unit) => unit.target?.trim())
      .map((unit) => [
        unitKey(unit),
        {
          jobId: 'inspect',
          documentId: unit.documentId,
          unitId: unit.unitId,
          sourceHash: unit.sourceHash,
          status: 'skipped' as const,
          source: unit.source,
          target: unit.target,
          metadata: unit.metadata,
        },
      ]),
  );
  const task: TranslationTask = {
    taskId: 'inspect-window-context',
    units: currentUnits,
  };

  return buildWindowModeContext({
    task,
    jobUnits,
    currentUnits,
    completedResults,
  });
}

function isRequestRow(row: FileParseRowArtifact): boolean {
  return !row.target.trim();
}

function validatePositiveInteger(
  value: number | undefined,
  name: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

function inferJsonOutputPath(outputPath: string): string {
  const parsed = parse(outputPath);
  const name = extname(outputPath) ? parsed.name : parsed.base;
  return join(parsed.dir, `${name}.json`);
}
