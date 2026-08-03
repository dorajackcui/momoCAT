import { basename } from 'path';
import type { Segment } from '@cat/core/models';
import type { Project } from '@cat/core/project';
import type { CATDatabase } from '@cat/db';
import { SqliteProjectRepository } from './adapters/sqlite/SqliteProjectRepository';
import { SqliteSettingsRepository } from './adapters/sqlite/SqliteSettingsRepository';
import { SqliteTBRepository } from './adapters/sqlite/SqliteTBRepository';
import type { FileParseRowArtifact, TBArtifact } from './artifacts';
import { parseExternalSpreadsheet, type ParsedSpreadsheetFile } from './modules/FileModule';
import { writeSourceTerminologyPrecheckSpreadsheet } from './modules/sourceTerminologyPrecheckSpreadsheet';
import { TBModule } from './modules/TBModule';
import type { AIRuntimeConfigProvider, AITransport } from './ports';
import { AIProviderCatalogService } from './providers/AIProviderCatalogService';
import { AIProviderTransport } from './providers/AIProviderTransport';
import { DefaultAIRuntimeConfigProvider } from './providers/AIRuntimeConfigService';
import { runBounded } from './RequestScheduler';
import { TBService } from './services/TBService';
import {
  SourceTerminologyExtractor,
  type SourceTerminologyAggregate,
  type SourceTerminologyExtractionResult,
  type SourceTerminologyUnit,
} from './SourceTerminologyExtractor';
import { resolveTagPolicy } from './tagPolicy';
import { createTransientSegment } from './transientSegment';
import type { LocalizationEngineOptions, TranslateFileInput } from './types';
import type { CancellationToken } from './job/types';

const DEFAULT_MAX_CELL_CHARS = 30000;

export interface SourceTerminologyPrecheckFileInput extends TranslateFileInput {
  providerId?: string | null;
  batchSize?: number;
  maxPromptChars?: number;
  maxAttempts?: number;
  maxConcurrency?: number;
  maxCellChars?: number;
  onProgress?: (current: number, total: number) => void;
  cancellationToken?: CancellationToken;
}

export interface SourceTerminologyPrecheckFileUnitResult {
  unitId: string;
  rowNumber: number;
  source: string;
  historicalTerms: SourceTerminologyUnit['historicalTerms'];
  historicalTb: string;
  sourceTerms: string[];
  status: 'ready' | 'error' | 'cancelled';
  error?: string;
}

export interface SourceTerminologyPrecheckFileResult {
  outputPath: string;
  units: SourceTerminologyPrecheckFileUnitResult[];
  terms: SourceTerminologyAggregate[];
  summary: {
    total: number;
    ready: number;
    error: number;
    cancelled: number;
    uniqueTerms: number;
  };
}

export interface LocalizationSourceTerminologyPrecheckerOptions extends Pick<
  LocalizationEngineOptions,
  'maxConcurrency'
> {
  aiTransport?: AITransport;
  aiRuntimeConfigProvider?: AIRuntimeConfigProvider;
  tbModule?: Pick<TBModule, 'inspect'>;
  extractor?: Pick<SourceTerminologyExtractor, 'extract'>;
}

interface RowWithSegment {
  row: FileParseRowArtifact;
  segment: Segment;
}

type HistoryResolution =
  | { status: 'ready'; artifact: TBArtifact }
  | { status: 'error'; error: string }
  | { status: 'cancelled' };

export class LocalizationSourceTerminologyPrechecker {
  private readonly projectRepo: SqliteProjectRepository;
  private readonly tbModule: Pick<TBModule, 'inspect'>;
  private readonly extractor: Pick<SourceTerminologyExtractor, 'extract'>;

  constructor(
    db: CATDatabase,
    private readonly options: LocalizationSourceTerminologyPrecheckerOptions = {},
  ) {
    this.projectRepo = new SqliteProjectRepository(db);
    const settingsRepo = new SqliteSettingsRepository(db);
    const tbRepo = new SqliteTBRepository(db);
    const tbService = new TBService(this.projectRepo, tbRepo);
    const aiTransport = options.aiTransport ?? new AIProviderTransport();
    const aiRuntimeConfigProvider =
      options.aiRuntimeConfigProvider ?? new DefaultAIRuntimeConfigProvider();
    const providerCatalogService = new AIProviderCatalogService(settingsRepo, aiTransport);

    this.tbModule = options.tbModule ?? new TBModule({ tbRepo, tbService });
    this.extractor =
      options.extractor ??
      new SourceTerminologyExtractor({
        providerCatalogService,
        aiRuntimeConfigProvider,
        aiTransport,
      });
  }

  async precheckFile(
    input: SourceTerminologyPrecheckFileInput,
  ): Promise<SourceTerminologyPrecheckFileResult> {
    const project = this.projectRepo.getProject(input.projectId);
    if (!project) {
      throw new Error(`Project not found: ${input.projectId}`);
    }

    const parsed = await parseExternalSpreadsheet(input);
    const tagPolicy = resolveTagPolicy(input.options?.tagPolicy);
    const sourceRows = parsed.artifact.rows.filter((row) => row.source.trim());
    await yieldForCancellation();
    if (input.cancellationToken?.isCancellationRequested() === true) {
      return this.writeCancelledResult(parsed, sourceRows, input.outputPath);
    }

    const documentId = `file:${basename(parsed.inputPath)}`;
    const rowsWithSegments = sourceRows.map((row, index) => ({
      row,
      segment: createTransientSegment(
        rowToUnit(row, project, parsed.inputPath),
        index,
        {
          projectId: project.id,
          sourceLanguage: project.srcLang,
          targetLanguage: project.tgtLang,
          fileName: basename(parsed.inputPath),
        },
        { tagPolicy },
      ),
    }));
    await yieldForCancellation();
    if (input.cancellationToken?.isCancellationRequested() === true) {
      return this.writeCancelledResult(parsed, sourceRows, input.outputPath);
    }
    input.onProgress?.(0, rowsWithSegments.length);

    const historyBySourceHash = await this.resolveHistories(
      project.id,
      rowsWithSegments,
      input.maxConcurrency ?? this.options.maxConcurrency,
      input.cancellationToken,
    );
    const extractionUnits: SourceTerminologyUnit[] = [];
    const precheckErrors = new Map<string, string>();
    const precheckCancelled = new Set<string>();
    const historyByUnitId = new Map<string, SourceTerminologyUnit['historicalTerms']>();

    for (const { row, segment } of rowsWithSegments) {
      const history = historyBySourceHash.get(segment.srcHash);
      if (!history) {
        precheckErrors.set(row.unitId, 'Historical TB lookup did not produce a result.');
        continue;
      }
      if (history.status === 'error') {
        precheckErrors.set(row.unitId, history.error);
        continue;
      }
      if (history.status === 'cancelled') {
        precheckCancelled.add(row.unitId);
        continue;
      }

      const historicalTerms = history.artifact.rawMatches.map((match) => ({
        sourceTerm: match.srcTerm,
        targetTerm: match.tgtTerm,
        note: match.note ?? null,
      }));
      historyByUnitId.set(row.unitId, historicalTerms);
      extractionUnits.push({
        documentId,
        unitId: row.unitId,
        source: row.source,
        rowNumber: row.rowNumber,
        historicalTerms,
        metadata: { rowIndex: row.rowIndex },
      });
    }

    let extraction: SourceTerminologyExtractionResult = {
      units: [],
      terms: [],
      summary: { total: 0, ready: 0, error: 0, cancelled: 0, uniqueTerms: 0 },
    };
    if (extractionUnits.length > 0) {
      extraction = await this.extractor.extract({
        sourceLanguage: project.srcLang,
        providerId: input.providerId ?? project.aiModel,
        units: extractionUnits,
        options: {
          batchSize: input.batchSize,
          maxPromptChars: input.maxPromptChars,
          maxAttempts: input.maxAttempts,
          maxConcurrency: input.maxConcurrency ?? this.options.maxConcurrency,
        },
        cancellationToken: input.cancellationToken,
        onProgress: (current) => {
          input.onProgress?.(
            precheckErrors.size + precheckCancelled.size + current,
            rowsWithSegments.length,
          );
        },
      });
    } else {
      input.onProgress?.(rowsWithSegments.length, rowsWithSegments.length);
    }

    const extractedByUnitId = new Map(extraction.units.map((unit) => [unit.unitId, unit] as const));
    const maxCellChars =
      validatePositiveInteger(input.maxCellChars, 'maxCellChars') ?? DEFAULT_MAX_CELL_CHARS;
    const units = rowsWithSegments.map(({ row }) => {
      const extracted = extractedByUnitId.get(row.unitId);
      const error = precheckErrors.get(row.unitId) ?? extracted?.error;
      const cancelled = precheckCancelled.has(row.unitId) || extracted?.status === 'cancelled';
      const historicalTerms = historyByUnitId.get(row.unitId) ?? [];
      return {
        unitId: row.unitId,
        rowNumber: row.rowNumber,
        source: row.source,
        historicalTerms,
        historicalTb: truncateCell(formatHistoricalTerms(historicalTerms), maxCellChars),
        sourceTerms: extracted?.sourceTerms ?? [],
        status: error
          ? ('error' as const)
          : cancelled
            ? ('cancelled' as const)
            : ('ready' as const),
        ...(error ? { error } : {}),
      };
    });

    await writeSourceTerminologyPrecheckSpreadsheet(
      parsed,
      units.map((unit) => ({
        unitId: unit.unitId,
        historicalTb: unit.historicalTb,
        sourceTerms: unit.sourceTerms,
        status: unit.status,
        error: unit.error,
      })),
      extraction.terms,
      input.outputPath,
    );

    return {
      outputPath: input.outputPath,
      units,
      terms: extraction.terms,
      summary: {
        total: units.length,
        ready: units.filter((unit) => unit.status === 'ready').length,
        error: units.filter((unit) => unit.status === 'error').length,
        cancelled: units.filter((unit) => unit.status === 'cancelled').length,
        uniqueTerms: extraction.terms.length,
      },
    };
  }

  private async writeCancelledResult(
    parsed: ParsedSpreadsheetFile,
    sourceRows: FileParseRowArtifact[],
    outputPath: string,
  ): Promise<SourceTerminologyPrecheckFileResult> {
    const units: SourceTerminologyPrecheckFileUnitResult[] = sourceRows.map((row) => ({
      unitId: row.unitId,
      rowNumber: row.rowNumber,
      source: row.source,
      historicalTerms: [],
      historicalTb: '',
      sourceTerms: [],
      status: 'cancelled',
    }));
    await writeSourceTerminologyPrecheckSpreadsheet(parsed, units, [], outputPath);
    return {
      outputPath,
      units,
      terms: [],
      summary: {
        total: units.length,
        ready: 0,
        error: 0,
        cancelled: units.length,
        uniqueTerms: 0,
      },
    };
  }

  private async resolveHistories(
    projectId: number,
    rows: RowWithSegment[],
    maxConcurrency?: number,
    cancellationToken?: CancellationToken,
  ): Promise<Map<string, HistoryResolution>> {
    const leadBySourceHash = new Map<string, RowWithSegment>();
    for (const row of rows) {
      if (!leadBySourceHash.has(row.segment.srcHash)) {
        leadBySourceHash.set(row.segment.srcHash, row);
      }
    }
    const groups = Array.from(leadBySourceHash.entries());
    const scheduled = await runBounded(
      groups,
      async ([, row]): Promise<HistoryResolution> => {
        if (cancellationToken?.isCancellationRequested() === true) {
          return { status: 'cancelled' };
        }
        return { status: 'ready', artifact: await this.tbModule.inspect(projectId, row.segment) };
      },
      { maxConcurrency },
    );
    const resolved = new Map<string, HistoryResolution>();
    scheduled.forEach((result, index) => {
      const sourceHash = groups[index][0];
      resolved.set(
        sourceHash,
        result.status === 'fulfilled'
          ? result.value
          : {
              status: 'error',
              error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            },
      );
    });
    return resolved;
  }
}

function yieldForCancellation(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
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
    metadata: { rowIndex: row.rowIndex, rowNumber: row.rowNumber },
  };
}

function formatHistoricalTerms(terms: SourceTerminologyUnit['historicalTerms']): string {
  if (!terms || terms.length === 0) return '';
  return [
    'Terminology References',
    ...terms.map((term, index) => {
      const target = term.targetTerm ? ` -> ${term.targetTerm}` : '';
      const note = term.note?.trim() ? ` (note: ${term.note.trim()})` : '';
      return `${index + 1}. ${term.sourceTerm}${target}${note}`;
    }),
  ].join('\n');
}

function truncateCell(value: string, maxCellChars: number): string {
  if (value.length <= maxCellChars) return value;
  const marker = '[TRUNCATED]';
  return `${value.slice(0, Math.max(0, maxCellChars - marker.length))}${marker}`;
}

function validatePositiveInteger(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}
