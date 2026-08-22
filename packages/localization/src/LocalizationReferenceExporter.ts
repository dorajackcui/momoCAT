import { basename } from 'path';
import type { Segment } from '@cat/core/models';
import { serializeTokensToDisplayText } from '@cat/core/text';
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
import {
  createProgressEmitter,
  fileParseRowToUnit,
  validatePositiveInteger,
} from './externalFileOperationSupport';

const DEFAULT_MAX_CELL_CHARS = 30000;
const CURRENT_TARGET_PAGE_SIZE = 2000;

export interface ExportReferencesForMtInput extends TranslateFileInput {
  unitLimit?: number;
  maxCellChars?: number;
  maxConcurrency?: number;
  /** Overlay output target cells from the persisted segments belonging to this database file. */
  currentTargetFileId?: number;
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

interface ReferenceRowWithSegment {
  row: FileParseRowArtifact;
  segment: Segment;
  sourceIndex: number;
}

export class LocalizationReferenceExporter {
  private readonly db: CATDatabase;
  private readonly projectRepo: SqliteProjectRepository;
  private readonly tmModule: TMModule;
  private readonly tbModule: TBModule;
  private readonly options: LocalizationReferenceExporterOptions;

  constructor(db: CATDatabase, options: LocalizationReferenceExporterOptions = {}) {
    this.db = db;
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
    const currentTargetFileId = validatePositiveInteger(
      input.currentTargetFileId,
      'currentTargetFileId',
    );
    const parsed = this.applyCurrentTargets(
      await parseExternalSpreadsheet(input),
      project.id,
      currentTargetFileId,
    );
    const tagPolicy = resolveTagPolicy(input.options?.tagPolicy);
    const sourceRows = parsed.artifact.rows.filter((row) => row.source.trim());
    const limitedRows = unitLimit === undefined ? sourceRows : sourceRows.slice(0, unitLimit);
    const rowsWithSegments = limitedRows.map((row, index) => {
      const segment = createTransientSegment(
        fileParseRowToUnit(row, project, parsed.inputPath),
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

  private applyCurrentTargets(
    parsed: Awaited<ReturnType<typeof parseExternalSpreadsheet>>,
    projectId: number,
    fileId: number | undefined,
  ): Awaited<ReturnType<typeof parseExternalSpreadsheet>> {
    if (fileId === undefined) return parsed;

    const fileProjectId = this.db.getProjectIdByFileId(fileId);
    if (fileProjectId === undefined) {
      throw new Error(`Current target file not found: ${fileId}`);
    }
    if (fileProjectId !== projectId) {
      throw new Error(`Current target file ${fileId} does not belong to project ${projectId}.`);
    }

    const targetsByRowIndex = new Map<number, string>();
    for (let offset = 0; ; offset += CURRENT_TARGET_PAGE_SIZE) {
      const page = this.db.getSegmentsPage(fileId, offset, CURRENT_TARGET_PAGE_SIZE);
      for (const segment of page) {
        targetsByRowIndex.set(
          segment.orderIndex,
          serializeTokensToDisplayText(segment.targetTokens),
        );
      }
      if (page.length < CURRENT_TARGET_PAGE_SIZE) break;
    }

    const firstDataRowIndex = parsed.columns.hasHeader ? 1 : 0;
    const rawRows = parsed.rawRows.map((row) => [...row]);
    for (const [rowIndex, target] of targetsByRowIndex) {
      if (rowIndex < firstDataRowIndex || rowIndex >= rawRows.length) {
        throw new Error(
          `Stored segment row ${rowIndex + 1} is outside the retained source workbook rows.`,
        );
      }
      rawRows[rowIndex][parsed.columns.targetCol] = target;
    }

    return {
      ...parsed,
      rawRows,
      artifact: {
        ...parsed.artifact,
        rows: parsed.artifact.rows.map((row) => {
          const target = targetsByRowIndex.get(row.rowIndex);
          return target === undefined ? row : { ...row, target };
        }),
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

    // Rows sharing a srcHash share TM/TB lookup results (same key the editor
    // reference cache uses), so the expensive queries run once per unique source.
    const groups = new Map<string, ReferenceRowWithSegment[]>();
    for (const rowWithSegment of rows) {
      const group = groups.get(rowWithSegment.segment.srcHash);
      if (group) {
        group.push(rowWithSegment);
      } else {
        groups.set(rowWithSegment.segment.srcHash, [rowWithSegment]);
      }
    }
    const groupList = [...groups.values()];

    await emitProgress(0);
    const scheduled = await runBounded(
      groupList,
      async (groupRows) => {
        const units = await this.resolveGroupReferences(project, groupRows, options.maxCellChars);
        completed += groupRows.length;
        await emitProgress(completed);
        return units;
      },
      { maxConcurrency: options.maxConcurrency },
    );

    const results = new Array<ReferenceExportUnitResult>(rows.length);
    scheduled.forEach((result, groupIndex) => {
      const groupRows = groupList[groupIndex];
      if (result.status === 'fulfilled') {
        result.value.forEach((unit, indexInGroup) => {
          results[groupRows[indexInGroup].sourceIndex] = unit;
        });
        return;
      }

      for (const { row, segment, sourceIndex } of groupRows) {
        const tm = emptyTMArtifact(row.unitId, segment.segmentId);
        const tb = emptyTBArtifact(row.unitId, segment.segmentId);
        results[sourceIndex] = {
          unit: row,
          transientSegment: segmentMetadata(segment),
          tm,
          tb,
          xlsx: buildReferenceXlsxFields({
            unit: { tm, tb },
            unitIndex: sourceIndex,
            maxCellChars: options.maxCellChars,
          }),
          status: 'error',
          error: errorMessage(result.reason),
        };
      }
    });

    return results;
  }

  private async resolveGroupReferences(
    project: ProjectRecord,
    groupRows: ReferenceRowWithSegment[],
    maxCellChars: number,
  ): Promise<ReferenceExportUnitResult[]> {
    const leadSegment = groupRows[0].segment;
    const [tmResult, tbResult] = await Promise.allSettled([
      this.tmModule.inspect(project.id, leadSegment),
      this.tbModule.inspect(project.id, leadSegment),
    ]);
    const referenceErrors = [
      stageError('tm', tmResult),
      stageError('tb', tbResult),
    ].filter((error): error is string => Boolean(error));

    return groupRows.map(({ row, segment, sourceIndex }) => {
      const tm =
        tmResult.status === 'fulfilled'
          ? { ...tmResult.value, unitId: row.unitId, segmentId: segment.segmentId }
          : emptyTMArtifact(row.unitId, segment.segmentId);
      const tb =
        tbResult.status === 'fulfilled'
          ? { ...tbResult.value, unitId: row.unitId, segmentId: segment.segmentId }
          : emptyTBArtifact(row.unitId, segment.segmentId);

      return {
        unit: row,
        transientSegment: segmentMetadata(segment),
        tm,
        tb,
        xlsx: buildReferenceXlsxFields({
          unit: { tm, tb },
          unitIndex: sourceIndex,
          maxCellChars,
        }),
        status: referenceErrors.length > 0 ? 'error' : 'ready',
        error: referenceErrors.length > 0 ? referenceErrors.join('; ') : undefined,
      };
    });
  }
}
