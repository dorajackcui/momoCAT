import { basename } from 'path';
import type { Segment } from '@cat/core/models';
import type { Project } from '@cat/core/project';
import type { CATDatabase } from '@cat/db';
import { SqliteProjectRepository } from './adapters/sqlite/SqliteProjectRepository';
import { SqliteTBRepository } from './adapters/sqlite/SqliteTBRepository';
import { SqliteTMRepository } from './adapters/sqlite/SqliteTMRepository';
import type {
  FileParseRowArtifact,
  TBArtifact,
  TMArtifact,
} from './artifacts';
import {
  buildReferenceXlsxFields,
  emptyTBArtifact,
  emptyTMArtifact,
  errorMessage,
  segmentMetadata,
  stageError,
} from './LocalizationInspectorArtifacts';
import { TBModule } from './modules/TBModule';
import { TMModule } from './modules/TMModule';
import {
  parseExternalSpreadsheet,
  writeReferencesForMtSpreadsheet,
} from './modules/FileModule';
import { runBounded } from './RequestScheduler';
import { TBService } from './services/TBService';
import { TMService } from './services/TMService';
import { resolveTagPolicy } from './tagPolicy';
import { createTransientSegment } from './transientSegment';
import type { LocalizationEngineOptions, TranslateFileInput } from './types';

const DEFAULT_MAX_CELL_CHARS = 30000;

export interface ExportReferencesForMtInput extends TranslateFileInput {
  unitLimit?: number;
  maxCellChars?: number;
  maxConcurrency?: number;
  onProgress?: (current: number, total: number) => void;
}

export interface ReferenceExportUnitResult {
  unit: FileParseRowArtifact;
  transientSegment: {
    segmentId: string;
    matchKey: string;
    srcHash: string;
    tagsSignature: string;
  };
  tm: TMArtifact;
  tb: TBArtifact;
  xlsx: ReturnType<typeof buildReferenceXlsxFields>;
  status: 'ready' | 'error';
  error?: string;
}

export interface ExportReferencesForMtResult {
  outputPath: string;
  summary: { total: number; ready: number; error: number };
  units: ReferenceExportUnitResult[];
}

export interface LocalizationReferenceExporterOptions
  extends Pick<LocalizationEngineOptions, 'maxConcurrency'> {
  tmModule?: TMModule;
  tbModule?: TBModule;
}

type ProjectRecord = NonNullable<ReturnType<SqliteProjectRepository['getProject']>>;
type ProgressEmitter = (current: number) => Promise<void>;

interface ReferenceRowWithSegment {
  row: FileParseRowArtifact;
  segment: Segment;
  sourceIndex: number;
}

export class LocalizationReferenceExporter {
  private readonly projectRepo: SqliteProjectRepository;
  private readonly tmModule: TMModule;
  private readonly tbModule: TBModule;
  private readonly options: LocalizationReferenceExporterOptions;

  constructor(db: CATDatabase, options: LocalizationReferenceExporterOptions = {}) {
    this.options = options;
    this.projectRepo = new SqliteProjectRepository(db);

    const tmRepo = new SqliteTMRepository(db);
    const tbRepo = new SqliteTBRepository(db);
    const tmService = new TMService(this.projectRepo, tmRepo);
    const tbService = new TBService(this.projectRepo, tbRepo);

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
  }

  async exportReferencesForMtFile(
    input: ExportReferencesForMtInput,
  ): Promise<ExportReferencesForMtResult> {
    const project = this.projectRepo.getProject(input.projectId);
    if (!project) {
      throw new Error(`Project not found: ${input.projectId}`);
    }

    const unitLimit = validatePositiveInteger(input.unitLimit, 'unitLimit');
    const maxCellChars =
      validatePositiveInteger(input.maxCellChars, 'maxCellChars') ?? DEFAULT_MAX_CELL_CHARS;
    const maxConcurrency =
      validatePositiveInteger(input.maxConcurrency, 'maxConcurrency') ??
      validatePositiveInteger(this.options.maxConcurrency, 'maxConcurrency');
    const parsed = await parseExternalSpreadsheet(input);
    const tagPolicy = resolveTagPolicy(input.options?.tagPolicy);
    const sourceRows = parsed.artifact.rows.filter((row) => row.source.trim());
    const limitedRows = unitLimit === undefined ? sourceRows : sourceRows.slice(0, unitLimit);
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

    const units = await this.resolveRows(project, rowsWithSegments, {
      maxCellChars,
      maxConcurrency,
      onProgress: input.onProgress,
    });

    await writeReferencesForMtSpreadsheet(
      parsed,
      units.map((unit) => ({
        unitId: unit.unit.unitId,
        tmForMt: unit.xlsx.tmForMt,
        tbForMt: unit.xlsx.tbForMt,
      })),
      input.outputPath,
    );

    return {
      outputPath: input.outputPath,
      units,
      summary: {
        total: units.length,
        ready: units.filter((unit) => unit.status === 'ready').length,
        error: units.filter((unit) => unit.status === 'error').length,
      },
    };
  }

  private async resolveRows(
    project: ProjectRecord,
    rows: ReferenceRowWithSegment[],
    options: {
      maxCellChars: number;
      maxConcurrency?: number;
      onProgress?: (current: number, total: number) => void;
    },
  ): Promise<ReferenceExportUnitResult[]> {
    const emitProgress = createProgressEmitter(options.onProgress, rows.length);
    let completed = 0;

    await emitProgress(0);
    const results = await runBounded(
      rows,
      async (rowWithSegment, unitIndex) => {
        const unit = await this.resolveRowReferences(
          project,
          rowWithSegment,
          unitIndex,
          options.maxCellChars,
        );
        completed += 1;
        await emitProgress(completed);
        return unit;
      },
      { maxConcurrency: options.maxConcurrency },
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') return result.value;

      const { row, segment } = rows[index];
      const tm = emptyTMArtifact(row.unitId, segment.segmentId);
      const tb = emptyTBArtifact(row.unitId, segment.segmentId);
      return {
        unit: row,
        transientSegment: segmentMetadata(segment),
        tm,
        tb,
        xlsx: buildReferenceXlsxFields({
          unit: { tm, tb },
          unitIndex: index,
          maxCellChars: options.maxCellChars,
        }),
        status: 'error',
        error: errorMessage(result.reason),
      };
    });
  }

  private async resolveRowReferences(
    project: ProjectRecord,
    rowWithSegment: ReferenceRowWithSegment,
    unitIndex: number,
    maxCellChars: number,
  ): Promise<ReferenceExportUnitResult> {
    const { row, segment } = rowWithSegment;
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

    return {
      unit: row,
      transientSegment: segmentMetadata(segment),
      tm,
      tb,
      xlsx: buildReferenceXlsxFields({
        unit: { tm, tb },
        unitIndex,
        maxCellChars,
      }),
      status: referenceErrors.length > 0 ? 'error' : 'ready',
      error: referenceErrors.length > 0 ? referenceErrors.join('; ') : undefined,
    };
  }
}

function rowToUnit(row: FileParseRowArtifact, project: Project, inputPath: string) {
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

function createProgressEmitter(
  onProgress: ((current: number, total: number) => void) | undefined,
  total: number,
): ProgressEmitter {
  let lastCurrent: number | undefined;

  return async (current: number): Promise<void> => {
    if (!onProgress || current === lastCurrent) return;
    lastCurrent = current;
    onProgress(current, total);
    await yieldToEventLoop();
  };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function validatePositiveInteger(value: number | undefined, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}
