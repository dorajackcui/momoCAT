import { writeFile } from 'fs/promises';
import { basename, extname, join, parse } from 'path';
import type { Segment } from '@cat/core/models';
import type { Project, ProjectType } from '@cat/core/project';
import { TagValidator } from '@cat/core/qa';
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
import type { MTBatchCurrentUnitInput } from './modules/MTModule';
import type { AIRuntimeConfigProvider, AITransport } from './ports';
import type {
  FileParseRowArtifact,
  InspectArtifact,
  InspectTruncatedFields,
  InspectUnitArtifact,
  PromptArtifact,
  TBArtifact,
  TMArtifact,
} from './artifacts';
import {
  parseExternalSpreadsheet,
  writeInspectSpreadsheet,
} from './modules/FileModule';
import { createTransientSegment } from './transientSegment';
import type {
  LocalizationEngineOptions,
  LocalizationMode,
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
    const sourceRows = parsed.artifact.rows.filter((row) => row.source.trim());
    const limitedRows =
      unitLimit === undefined ? sourceRows : sourceRows.slice(0, unitLimit);

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
      );
      return { row, segment };
    });

    const units = await this.inspectRowsWindowMode(
      project,
      rowsWithSegments,
      sourceRows,
      parsed.inputPath,
      maxCellChars,
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

  private async inspectRowsWindowMode(
    project: ProjectRecord,
    rows: InspectRowWithSegment[],
    contextRows: FileParseRowArtifact[],
    inputPath: string,
    maxCellChars: number,
  ): Promise<InspectUnitArtifact[]> {
    const units = await Promise.all(
      rows.map(({ row, segment }) =>
        this.inspectRowReferences(project, row, segment),
      ),
    );
    const inputDocumentId = basename(inputPath);

    for (
      let batchStart = 0;
      batchStart < rows.length;
      batchStart += INSPECT_BATCH_SIZE
    ) {
      const batchRows = rows.slice(batchStart, batchStart + INSPECT_BATCH_SIZE);
      const batchUnits = units.slice(
        batchStart,
        batchStart + INSPECT_BATCH_SIZE,
      );
      const readyRows = batchRows
        .map((rowWithSegment, index) => ({
          ...rowWithSegment,
          unit: batchUnits[index],
          unitIndex: batchStart + index,
        }))
        .filter(
          (
            item,
          ): item is InspectRowWithSegment & {
            unit: InspectUnitArtifact;
            unitIndex: number;
          } => item.unit?.status === 'ready',
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
          previousContext: buildPreviousTranslatedContext(contextRows, readyRows),
          nextContext: buildNextSourceContext(contextRows, readyRows),
          mtOptions: this.options.mt,
          providerOverride: this.options.mt?.providerId,
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

function buildXlsxFields(
  mt: PromptArtifact,
  unitIndex: number,
  maxCellChars: number,
): InspectUnitArtifact['xlsx'] {
  const tmPromptInput = [mt.tmPromptBlock, mt.concordancePromptBlock]
    .filter((block) => block.length > 0)
    .join('\n\n');
  const tmForMt = truncateForCell(
    tmPromptInput,
    maxCellChars,
    `#/units/${unitIndex}/mt/userPrompt`,
  );
  const tbForMt = truncateForCell(
    mt.tbPromptBlock,
    maxCellChars,
    `#/units/${unitIndex}/mt/tbPromptBlock`,
  );
  const mtUserPrompt = truncateForCell(
    mt.userPrompt,
    maxCellChars,
    `#/units/${unitIndex}/mt/userPrompt`,
  );

  return {
    tmForMt: tmForMt.value,
    tbForMt: tbForMt.value,
    mtUserPrompt: mtUserPrompt.value,
    truncated: {
      tmForMt: tmForMt.truncated,
      tbForMt: tbForMt.truncated,
      mtUserPrompt: mtUserPrompt.truncated,
    },
  };
}

function emptyXlsxFields(): InspectUnitArtifact['xlsx'] {
  return {
    tmForMt: '',
    tbForMt: '',
    mtUserPrompt: '',
    truncated: {
      tmForMt: false,
      tbForMt: false,
      mtUserPrompt: false,
    },
  };
}

function buildPreviousTranslatedContext(
  rows: FileParseRowArtifact[],
  currentRows: Array<InspectRowWithSegment & { unitIndex: number }>,
): Array<{ source: string; target: string }> {
  const currentIndexes = new Set(currentRows.map((row) => row.unitIndex));
  const candidates = new Set<number>();

  for (const currentIndex of currentIndexes) {
    for (let index = currentIndex - 1; index >= 0; index -= 1) {
      if (rows[index].target.trim()) {
        candidates.add(index);
      }
    }
  }

  return [...candidates]
    .sort((left, right) => left - right)
    .slice(-5)
    .map((index) => ({
      source: rows[index].source,
      target: rows[index].target,
    }));
}

function buildNextSourceContext(
  rows: FileParseRowArtifact[],
  currentRows: Array<InspectRowWithSegment & { unitIndex: number }>,
): Array<{ source: string }> {
  const candidates = new Set<number>();

  for (const { unitIndex } of currentRows) {
    for (let index = unitIndex + 1; index < rows.length; index += 1) {
      if (rows[index].source.trim()) {
        candidates.add(index);
      }
    }
  }

  return [...candidates]
    .sort((left, right) => left - right)
    .slice(0, 5)
    .map((index) => ({ source: rows[index].source }));
}

function truncateForCell(
  value: string,
  maxCellChars: number,
  jsonRef: string,
): {
  value: string;
  truncated: boolean;
} {
  if (value.length <= maxCellChars) {
    return { value, truncated: false };
  }

  const marker = `[TRUNCATED: see ${jsonRef}]`;
  return {
    value:
      marker.length <= maxCellChars ? marker : marker.slice(0, maxCellChars),
    truncated: true,
  };
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

function stageError<T>(
  stage: string,
  result: PromiseSettledResult<T>,
): string | undefined {
  if (result.status === 'fulfilled') {
    return undefined;
  }

  return `${stage}: ${errorMessage(result.reason)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildErrorUnit(params: {
  row: FileParseRowArtifact;
  segment: Segment;
  project: ProjectRecord;
  tm: TMArtifact;
  tb: TBArtifact;
  error: string;
}): InspectUnitArtifact {
  return {
    unit: params.row,
    transientSegment: segmentMetadata(params.segment),
    tm: params.tm,
    tb: params.tb,
    mt: emptyPromptArtifact(params.row.unitId, params.project),
    xlsx: emptyXlsxFields(),
    status: 'error',
    error: params.error,
  };
}

function segmentMetadata(
  segment: Segment,
): InspectUnitArtifact['transientSegment'] {
  return {
    segmentId: segment.segmentId,
    matchKey: segment.matchKey,
    srcHash: segment.srcHash,
    tagsSignature: segment.tagsSignature,
  };
}

function emptyTMArtifact(unitId: string, segmentId: string): TMArtifact {
  return {
    unitId,
    segmentId,
    mountedTMs: [],
    rawMatches: [],
    selectedReferences: {
      tmReferences: [],
      concordanceReferences: [],
    },
    selectionPolicy: {
      maxTmReferences: 0,
      maxConcordanceReferences: 0,
    },
    diagnostics: [],
  };
}

function emptyTBArtifact(unitId: string, segmentId: string): TBArtifact {
  return {
    unitId,
    segmentId,
    mountedTBs: [],
    rawMatches: [],
    selectedReferences: [],
    selectionPolicy: {
      maxTbReferences: 0,
    },
    diagnostics: [],
  };
}

function emptyPromptArtifact(
  unitId: string,
  project: Pick<Project, 'projectType'>,
): PromptArtifact {
  return {
    unitId,
    provider: {
      id: null,
      name: null,
      baseUrl: null,
    },
    model: null,
    reasoningEffort: null,
    projectPrompt: '',
    projectType: (project.projectType ?? 'translation') as ProjectType,
    sourcePayload: '',
    tmPromptBlock: '',
    concordancePromptBlock: '',
    tbPromptBlock: '',
    referencePromptBlock: '',
    systemPrompt: '',
    userPrompt: '',
    promptChars: {
      system: 0,
      user: 0,
      total: 0,
    },
  };
}

function inferJsonOutputPath(outputPath: string): string {
  const parsed = parse(outputPath);
  const name = extname(outputPath) ? parsed.name : parsed.base;
  return join(parsed.dir, `${name}.json`);
}
