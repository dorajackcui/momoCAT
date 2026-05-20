import { createHash } from 'crypto';
import type { Segment } from '@cat/core/models';
import { normalizeProjectAIModel } from '@cat/core/project';
import { TagValidator } from '@cat/core/qa';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { CATDatabase } from '@cat/db';
import { MTModule, type MTBatchCurrentUnitInput, type ResolvedMTConfig } from './modules/MTModule';
import { TBModule, mapTBEngineReferences } from './modules/TBModule';
import { TMModule, mapTMEngineReferences } from './modules/TMModule';
import { TBService } from './services/TBService';
import { TMService } from './services/TMService';
import { SqliteProjectRepository } from './adapters/sqlite/SqliteProjectRepository';
import { SqliteSettingsRepository } from './adapters/sqlite/SqliteSettingsRepository';
import { SqliteTBRepository } from './adapters/sqlite/SqliteTBRepository';
import { SqliteTMRepository } from './adapters/sqlite/SqliteTMRepository';
import { DefaultAIRuntimeConfigProvider } from './providers/AIRuntimeConfigService';
import { AIProviderCatalogService } from './providers/AIProviderCatalogService';
import { resolveBatchTargetScope } from './translationTargetScope';
import { AIProviderTransport } from './providers/AIProviderTransport';
import type { AIRuntimeConfigProvider, AITransport } from './ports';
import { runBounded } from './RequestScheduler';
import { translateSpreadsheetFileJob } from './fileTranslationJobAdapter';
import { translateSpreadsheetFile } from './spreadsheetFileAdapter';
import { createTransientSegment } from './transientSegment';
import type {
  ArtifactRecord,
  JobUnit,
  TaskExecutionContext,
  TaskExecutionResult,
  TranslationTask,
  TranslationTaskExecutor,
  UnitResult,
  UnitResultStatus,
} from './job/types';
import type {
  ExternalTranslationUnit,
  LocalizationEngineOptions,
  LocalizationEngineProfile,
  LocalizationMode,
  LocalizationTargetScope,
  TranslateFileInput,
  TranslateFileResult,
  TranslateUnitReferences,
  TranslateUnitResult,
  TranslateUnitsInput,
  TranslateUnitsResult,
} from './types';

export interface LocalizationEngineConstructorOptions extends LocalizationEngineOptions {
  dbPath: string;
  aiTransport?: AITransport;
  aiRuntimeConfigProvider?: AIRuntimeConfigProvider;
}

interface ResolvedReferences {
  engineReferences: TranslateUnitReferences;
  tm: Awaited<ReturnType<TMModule['inspect']>>;
  tb: Awaited<ReturnType<TBModule['inspect']>>;
}

interface PreparedTranslationArtifacts {
  tm: ResolvedReferences['tm'];
  tb: ResolvedReferences['tb'];
  prompt: Awaited<ReturnType<MTModule['translate']>>['prompt'];
}

interface PreparedTranslationResult {
  result: TranslateUnitResult;
  artifacts?: PreparedTranslationArtifacts;
}

interface PreparedWindowBatchResult {
  results: UnitResult[];
  artifacts?: ArtifactRecord[];
}

type ProjectRecord = NonNullable<ReturnType<SqliteProjectRepository['getProject']>>;

type PreparedUnit =
  | {
      kind: 'skipped';
      result: TranslateUnitResult;
    }
  | {
      kind: 'translatable';
      unit: ExternalTranslationUnit;
      segment: Segment;
    };

export class LocalizationEngine {
  private readonly projectRepo: SqliteProjectRepository;
  private readonly settingsRepo: SqliteSettingsRepository;
  private readonly tmRepo: SqliteTMRepository;
  private readonly tbRepo: SqliteTBRepository;
  private readonly tmService: TMService;
  private readonly tbService: TBService;
  private readonly providerCatalogService: AIProviderCatalogService;
  private readonly aiRuntimeConfigProvider: AIRuntimeConfigProvider;
  private readonly tmModule: TMModule;
  private readonly tbModule: TBModule;
  private readonly mtModule: MTModule;
  private readonly options: LocalizationEngineConstructorOptions;

  constructor(db: CATDatabase, options: LocalizationEngineConstructorOptions) {
    this.options = options;
    this.projectRepo = new SqliteProjectRepository(db);
    this.settingsRepo = new SqliteSettingsRepository(db);
    this.tmRepo = new SqliteTMRepository(db);
    this.tbRepo = new SqliteTBRepository(db);
    this.tmService = new TMService(this.projectRepo, this.tmRepo);
    this.tbService = new TBService(this.projectRepo, this.tbRepo);

    const aiTransport = options.aiTransport ?? new AIProviderTransport();
    this.providerCatalogService = new AIProviderCatalogService(this.settingsRepo, aiTransport);
    this.aiRuntimeConfigProvider =
      options.aiRuntimeConfigProvider ?? new DefaultAIRuntimeConfigProvider();
    this.tmModule = new TMModule({
      tmRepo: this.tmRepo,
      tmService: this.tmService,
    });
    this.tbModule = new TBModule({
      tbRepo: this.tbRepo,
      tbService: this.tbService,
    });
    this.mtModule = new MTModule({
      providerCatalogService: this.providerCatalogService,
      aiRuntimeConfigProvider: this.aiRuntimeConfigProvider,
      aiTransport,
      tagValidator: new TagValidator(),
    });
  }

  public async inspectProject(projectId: number): Promise<LocalizationEngineProfile> {
    const project = this.projectRepo.getProject(projectId);
    if (!project) {
      return {
        projectId,
        projectName: '',
        srcLang: '',
        tgtLang: '',
        promptChars: 0,
        model: null,
        apiKeySet: false,
        mountedTMCount: 0,
        mountedTBCount: 0,
        ready: false,
        errors: ['Project not found'],
      };
    }

    const errors: string[] = [];
    let model: string | null = null;
    let apiKeySet = false;
    const providerId = this.options.mt?.providerId ?? project.aiModel;

    try {
      const config = await this.mtModule.resolveConfig(project, this.options.mt);
      model = config.model;
      apiKeySet = config.apiKey.trim().length > 0;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      const normalizedProviderId = normalizeProjectAIModel(providerId);
      const provider = this.providerCatalogService
        .listProviders()
        .find((candidate) => candidate.id === normalizedProviderId);
      model = this.options.mt?.model ?? provider?.model ?? null;
      apiKeySet = Boolean(provider?.apiKeyLast4);
    }

    return {
      projectId: project.id,
      projectName: project.name,
      srcLang: project.srcLang,
      tgtLang: project.tgtLang,
      promptChars: project.aiPrompt?.length ?? 0,
      model,
      apiKeySet,
      mountedTMCount: this.tmRepo.getProjectMountedTMs(projectId).length,
      mountedTBCount: this.tbRepo.getProjectMountedTermBases(projectId).length,
      ready: errors.length === 0,
      errors,
    };
  }

  public async translateUnits(input: TranslateUnitsInput): Promise<TranslateUnitsResult> {
    const project = this.projectRepo.getProject(input.projectId);
    if (!project) {
      throw new Error(`Project not found: ${input.projectId}`);
    }

    const mode = this.resolveMode(input.options?.mode);
    if (mode === 'dialogue') {
      throw new Error('Dialogue mode is not supported for external translation units.');
    }

    const targetScope = resolveBatchTargetScope(
      input.options?.targetScope ?? this.options.defaultTargetScope,
    ) as LocalizationTargetScope;
    const maxConcurrency = input.options?.maxConcurrency ?? this.options.maxConcurrency;
    const preparedUnits = input.units.map((unit, index) =>
      this.prepareUnit(unit, index, project, targetScope),
    );
    const hasTranslatableUnits = preparedUnits.some((prepared) => prepared.kind === 'translatable');

    if (!hasTranslatableUnits) {
      return buildTranslateUnitsResult(
        preparedUnits.map((prepared) => {
          if (prepared.kind !== 'skipped') {
            throw new Error('Unexpected translatable unit in skip-only batch.');
          }
          return prepared.result;
        }),
      );
    }

    const mtOptions = mergeMTOptions(this.options.mt, input.options?.mt);
    const mtConfig = await this.mtModule.resolveConfig(
      project,
      mtOptions,
      input.options?.providerOverride,
    );

    const scheduledResults = await runBounded(
      preparedUnits,
      async (prepared) => {
        if (prepared.kind === 'skipped') {
          return prepared.result;
        }

        return (
          await this.translatePreparedUnitWithArtifacts({
            unit: prepared.unit,
            segment: prepared.segment,
            project,
            mtConfig,
            mtOptions,
            includeReferences: Boolean(input.options?.includeReferences),
            captureArtifacts: false,
          })
        ).result;
      },
      { maxConcurrency },
    );

    const results = scheduledResults.map((result, index): TranslateUnitResult => {
      if (result.status === 'fulfilled') {
        return result.value;
      }

      const unit = input.units[index];
      return {
        id: unit.id,
        source: unit.source,
        target: unit.target,
        status: 'failed',
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        metadata: unit.metadata,
      };
    });

    return buildTranslateUnitsResult(results);
  }

  public createTaskExecutor(): TranslationTaskExecutor {
    return (task, context) => this.executeTranslationTask(task, context);
  }

  public async executeTranslationTask(
    task: TranslationTask,
    context: TaskExecutionContext,
  ): Promise<TaskExecutionResult> {
    const project = this.projectRepo.getProject(context.job.projectId);
    if (!project) {
      throw new Error(`Project not found: ${context.job.projectId}`);
    }

    const translationOptions = context.job.translationOptions;
    const mode = this.resolveMode(translationOptions?.mode);
    if (mode === 'dialogue') {
      throw new Error('Dialogue mode is not supported for external translation units.');
    }

    const targetScope = resolveBatchTargetScope(
      translationOptions?.targetScope ?? this.options.defaultTargetScope,
    ) as LocalizationTargetScope;
    const preparedUnits = task.units.map((unit, index) =>
      this.prepareUnit(jobUnitToExternalUnit(unit), index, project, targetScope),
    );
    const hasTranslatableUnits = preparedUnits.some((prepared) => prepared.kind === 'translatable');
    const captureArtifacts = context.captureArtifacts !== false;
    const results: Array<UnitResult | undefined> = [];
    const artifacts: ArtifactRecord[] | undefined = captureArtifacts ? [] : undefined;
    const skippedResults: UnitResult[] = [];
    const translatableUnits: Array<{
      jobUnit: JobUnit;
      prepared: Extract<PreparedUnit, { kind: 'translatable' }>;
    }> = [];

    for (let index = 0; index < preparedUnits.length; index += 1) {
      const jobUnit = task.units[index];
      const prepared = preparedUnits[index];

      if (!jobUnit || !prepared) {
        continue;
      }

      if (prepared.kind === 'skipped') {
        const result = toUnitResult(context.job.id, jobUnit, prepared.result);
        results[index] = result;
        skippedResults.push(result);
        artifacts?.push(toArtifactRecord(context.job.id, task.taskId, jobUnit, result));
        continue;
      }

      translatableUnits.push({ jobUnit, prepared });
    }

    if (!hasTranslatableUnits || translatableUnits.length === 0) {
      return { results: results.flatMap((result) => (result ? [result] : [])), artifacts };
    }

    const mtOptions = mergeMTOptions(this.options.mt, translationOptions?.mt);
    const mtConfig = await this.mtModule.resolveConfig(
      project,
      mtOptions,
      translationOptions?.providerOverride,
    );
    const translated = await this.translatePreparedWindowBatchWithArtifacts({
      task,
      context,
      project,
      mtConfig,
      mtOptions,
      includeReferences: Boolean(translationOptions?.includeReferences),
      captureArtifacts,
      translatableUnits,
      skippedResults,
    });
    const translatedByKey = new Map(translated.results.map((result) => [unitKey(result), result]));

    for (let index = 0; index < task.units.length; index += 1) {
      if (results[index]) {
        continue;
      }
      const translatedResult = translatedByKey.get(unitKey(task.units[index]));
      if (translatedResult) {
        results[index] = translatedResult;
      }
    }
    artifacts?.push(...(translated.artifacts ?? []));

    return { results: results.flatMap((result) => (result ? [result] : [])), artifacts };
  }

  public async translateFile(input: TranslateFileInput): Promise<TranslateFileResult> {
    if (input.job) {
      const mode = this.resolveMode(input.options?.mode);
      if (mode === 'dialogue') {
        throw new Error('Dialogue mode is not supported for external translation units.');
      }

      const project = this.projectRepo.getProject(input.projectId);
      if (!project) {
        throw new Error(`Project not found: ${input.projectId}`);
      }
      const resumeFingerprint = await this.buildFileTranslationResumeFingerprint(input, project);

      return translateSpreadsheetFileJob(
        {
          ...input,
          job: {
            ...input.job,
            resumeFingerprint,
          },
        },
        {
          taskExecutor: this.createTaskExecutor(),
          defaultMaxConcurrency: this.options.maxConcurrency,
        },
      );
    }

    return translateSpreadsheetFile(input, (units) =>
      this.translateUnits({
        projectId: input.projectId,
        units,
        options: input.options,
      }),
    );
  }

  private resolveMode(mode?: LocalizationMode): LocalizationMode {
    return mode ?? this.options.defaultMode ?? 'standard';
  }

  private async buildFileTranslationResumeFingerprint(
    input: TranslateFileInput,
    project: ProjectRecord,
  ): Promise<string> {
    const targetScope = resolveBatchTargetScope(
      input.options?.targetScope ?? this.options.defaultTargetScope,
    );
    const mode = this.resolveMode(input.options?.mode);
    const mtOptions = mergeMTOptions(this.options.mt, input.options?.mt);
    const mtConfig = await this.mtModule.resolvePromptConfig(
      project,
      mtOptions,
      input.options?.providerOverride,
    );
    const mountedTMs = this.tmRepo
      .getProjectMountedTMs(project.id)
      .map((tm) => {
        const stats = this.tmRepo.getTMStats(tm.id);
        return {
          id: tm.id,
          srcLang: tm.srcLang,
          tgtLang: tm.tgtLang,
          type: tm.type,
          priority: tm.priority,
          permission: tm.permission,
          isEnabled: tm.isEnabled,
          updatedAt: tm.updatedAt,
          entryCount: stats.entryCount,
          maxEntryUpdatedAt: stats.maxEntryUpdatedAt,
        };
      })
      .sort(compareResourceFingerprint);
    const mountedTBs = this.tbRepo
      .getProjectMountedTermBases(project.id)
      .map((tb) => {
        const stats = this.tbRepo.getTermBaseStats(tb.id);
        return {
          id: tb.id,
          srcLang: tb.srcLang,
          tgtLang: tb.tgtLang,
          priority: tb.priority,
          isEnabled: tb.isEnabled,
          updatedAt: tb.updatedAt,
          entryCount: stats.entryCount,
          maxEntryUpdatedAt: stats.maxEntryUpdatedAt,
        };
      })
      .sort(compareResourceFingerprint);

    return hashCanonicalPayload([
      ['project.id', project.id],
      ['project.srcLang', project.srcLang],
      ['project.tgtLang', project.tgtLang],
      ['project.type', project.projectType ?? 'translation'],
      ['targetScope', targetScope],
      ['mode', mode],
      ['provider.id', mtConfig.provider.id],
      ['provider.kind', mtConfig.provider.kind],
      ['provider.protocol', mtConfig.provider.protocol],
      ['provider.baseUrl', mtConfig.provider.baseUrl],
      ['model', mtConfig.model],
      ['reasoningEffort', mtConfig.reasoningEffort],
      ['temperature', mtOptions.temperature],
      ['projectPrompt', mtOptions.systemPrompt ?? project.aiPrompt ?? ''],
      ['mountedTMs', mountedTMs],
      ['mountedTBs', mountedTBs],
    ]);
  }

  private prepareUnit(
    unit: ExternalTranslationUnit,
    index: number,
    project: ProjectRecord,
    targetScope: LocalizationTargetScope,
  ): PreparedUnit {
    const source = unit.source;
    if (!source.trim()) {
      return {
        kind: 'skipped',
        result: {
          id: unit.id,
          source,
          target: unit.target ?? '',
          status: 'skipped',
          metadata: unit.metadata,
        },
      };
    }

    const segment = createTransientSegment(unit, index, {
      projectId: project.id,
      sourceLanguage: project.srcLang,
      targetLanguage: project.tgtLang,
      fileName: unit.fileName,
    });
    const existingTarget = serializeTokensToDisplayText(segment.targetTokens);
    if (targetScope === 'blank-only' && existingTarget.trim()) {
      return {
        kind: 'skipped',
        result: {
          id: unit.id,
          source,
          target: existingTarget,
          status: 'skipped',
          metadata: unit.metadata,
        },
      };
    }

    return {
      kind: 'translatable',
      unit,
      segment,
    };
  }

  private async translatePreparedUnitWithArtifacts(params: {
    unit: ExternalTranslationUnit;
    segment: Segment;
    project: ProjectRecord;
    mtConfig: ResolvedMTConfig;
    mtOptions: NonNullable<LocalizationEngineOptions['mt']>;
    includeReferences: boolean;
    captureArtifacts: boolean;
  }): Promise<PreparedTranslationResult> {
    const source = params.unit.source;
    const projectType = params.project.projectType ?? 'translation';
    const references =
      projectType === 'translation'
        ? await this.resolveReferences(params.project.id, params.segment)
        : emptyReferencesForUnit({ unitId: params.unit.id }, params.segment);

    const { targetTokens, prompt } = await this.mtModule.translate({
      unitId: params.unit.id,
      project: params.project,
      segment: params.segment,
      tm: references.tm,
      tb: references.tb,
      mtOptions: params.mtOptions,
      apiKey: params.mtConfig.apiKey,
      baseUrl: params.mtConfig.provider.baseUrl,
      model: params.mtConfig.model,
      reasoningEffort: params.mtConfig.reasoningEffort,
      provider: params.mtConfig.provider,
      srcLang: params.unit.sourceLanguage ?? params.project.srcLang,
      tgtLang: params.unit.targetLanguage ?? params.project.tgtLang,
    });

    return {
      result: {
        id: params.unit.id,
        source,
        target: serializeTokensToDisplayText(targetTokens),
        status: 'translated',
        references: params.includeReferences ? references.engineReferences : undefined,
        metadata: params.unit.metadata,
      },
      artifacts: params.captureArtifacts
        ? {
            tm: references.tm,
            tb: references.tb,
            prompt,
          }
        : undefined,
    };
  }

  private async resolveReferences(
    projectId: number,
    segment: Segment,
  ): Promise<ResolvedReferences> {
    const [tmMatches, tbMatches] = await Promise.all([
      this.tmModule.inspect(projectId, segment),
      this.tbModule.inspect(projectId, segment),
    ]);

    return {
      engineReferences: {
        tm: mapTMEngineReferences(tmMatches.rawMatches),
        tb: mapTBEngineReferences(tbMatches.rawMatches),
      },
      tm: tmMatches,
      tb: tbMatches,
    };
  }

  private async translatePreparedWindowBatchWithArtifacts(params: {
    task: TranslationTask;
    context: TaskExecutionContext;
    project: ProjectRecord;
    mtConfig: ResolvedMTConfig;
    mtOptions: NonNullable<LocalizationEngineOptions['mt']>;
    includeReferences: boolean;
    captureArtifacts: boolean;
    translatableUnits: Array<{
      jobUnit: JobUnit;
      prepared: Extract<PreparedUnit, { kind: 'translatable' }>;
    }>;
    skippedResults: UnitResult[];
  }): Promise<PreparedWindowBatchResult> {
    const projectType = params.project.projectType ?? 'translation';
    const resolvedUnits = await Promise.all(
      params.translatableUnits.map(async ({ jobUnit, prepared }) => {
        const references =
          projectType === 'translation'
            ? await this.resolveReferences(params.project.id, prepared.segment)
            : emptyReferencesForUnit(jobUnit, prepared.segment);

        return { jobUnit, prepared, references };
      }),
    );
    const current: MTBatchCurrentUnitInput[] = resolvedUnits.map(
      ({ jobUnit, prepared, references }) => ({
        responseId: batchResponseId(jobUnit),
        documentId: jobUnit.documentId,
        unitId: jobUnit.unitId,
        segment: prepared.segment,
        tm: references.tm,
        tb: references.tb,
        context: jobUnit.context,
      }),
    );
    const completedResults = mergeCompletedResults(
      params.context.completedResults,
      params.skippedResults,
    );
    const previousContext = this.buildPreviousTranslatedContext({
      task: params.task,
      jobUnits: params.context.job.units,
      currentUnits: resolvedUnits.map((unit) => unit.jobUnit),
      completedResults,
    });
    const nextContext = this.buildNextSourceContext({
      task: params.task,
      jobUnits: params.context.job.units,
      currentUnits: resolvedUnits.map((unit) => unit.jobUnit),
    });
    const meta = current[0]?.segment.meta as
      | (Segment['meta'] & { sourceLanguage?: unknown; targetLanguage?: unknown })
      | undefined;
    const batch = await this.mtModule.translateBatch({
      taskId: params.task.taskId,
      project: params.project,
      current,
      previousContext,
      nextContext,
      mtOptions: params.mtOptions,
      apiKey: params.mtConfig.apiKey,
      baseUrl: params.mtConfig.provider.baseUrl,
      model: params.mtConfig.model,
      reasoningEffort: params.mtConfig.reasoningEffort,
      provider: params.mtConfig.provider,
      srcLang: meta?.sourceLanguage ? String(meta.sourceLanguage) : params.project.srcLang,
      tgtLang: meta?.targetLanguage ? String(meta.targetLanguage) : params.project.tgtLang,
    });
    const batchResultsByResponseId = new Map(
      batch.results.map((result) => [result.responseId, result]),
    );
    const results: UnitResult[] = [];
    const artifacts: ArtifactRecord[] | undefined = params.captureArtifacts ? [] : undefined;

    for (const { jobUnit, references } of resolvedUnits) {
      const batchResult = batchResultsByResponseId.get(batchResponseId(jobUnit));
      if (!batchResult) {
        throw new Error(`MT batch did not return a result for unit: ${jobUnit.unitId}`);
      }

      const result: UnitResult = {
        jobId: params.context.job.id,
        documentId: jobUnit.documentId,
        unitId: jobUnit.unitId,
        sourceHash: jobUnit.sourceHash,
        status: 'translated',
        source: jobUnit.source,
        target: serializeTokensToDisplayText(batchResult.targetTokens),
        references: params.includeReferences ? references.engineReferences : undefined,
        metadata: jobUnit.metadata,
      };
      results.push(result);
      artifacts?.push(
        toArtifactRecord(params.context.job.id, params.task.taskId, jobUnit, result, {
          tm: references.tm,
          tb: references.tb,
          prompt: batch.prompt,
        }),
      );
    }

    return { results, artifacts };
  }

  private buildPreviousTranslatedContext(params: {
    task: TranslationTask;
    jobUnits: JobUnit[];
    currentUnits: JobUnit[];
    completedResults: ReadonlyMap<string, UnitResult>;
  }): Array<{ source: string; target: string }> {
    const jobOrder = resolveJobOrder(params.jobUnits, params.task.units, params.currentUnits);
    const currentKeys = new Set(params.currentUnits.map(unitKey));
    let lastCurrentIndex = -1;

    for (let index = 0; index < jobOrder.length; index += 1) {
      if (currentKeys.has(unitKey(jobOrder[index]))) {
        lastCurrentIndex = index;
      }
    }

    if (lastCurrentIndex < 0) {
      return [];
    }

    const rows: Array<{ source: string; target: string }> = [];
    for (let index = lastCurrentIndex - 1; index >= 0 && rows.length < 5; index -= 1) {
      const unit = jobOrder[index];
      if (currentKeys.has(unitKey(unit))) {
        continue;
      }

      const completed = params.completedResults.get(unitKey(unit));
      const target = completed?.target;

      if (target?.trim()) {
        rows.push({ source: unit.source, target });
      }
    }

    return rows.reverse();
  }

  private buildNextSourceContext(params: {
    task: TranslationTask;
    jobUnits: JobUnit[];
    currentUnits: JobUnit[];
  }): Array<{ source: string }> {
    const jobOrder = resolveJobOrder(params.jobUnits, params.task.units, params.currentUnits);
    const currentKeys = new Set(params.currentUnits.map(unitKey));
    let lastCurrentIndex = -1;

    for (let index = 0; index < jobOrder.length; index += 1) {
      if (currentKeys.has(unitKey(jobOrder[index]))) {
        lastCurrentIndex = index;
      }
    }

    if (lastCurrentIndex < 0) {
      return [];
    }

    const rows: Array<{ source: string }> = [];
    for (let index = lastCurrentIndex + 1; index < jobOrder.length && rows.length < 5; index += 1) {
      const source = jobOrder[index].source;

      if (source.trim()) {
        rows.push({ source });
      }
    }

    return rows;
  }
}

function emptyReferencesForUnit(unit: Pick<JobUnit, 'unitId'>, segment: Segment): ResolvedReferences {
  return {
    engineReferences: {
      tm: [],
      tb: [],
    },
    tm: {
      unitId: unit.unitId,
      segmentId: segment.segmentId,
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
    },
    tb: {
      unitId: unit.unitId,
      segmentId: segment.segmentId,
      mountedTBs: [],
      rawMatches: [],
      selectedReferences: [],
      selectionPolicy: {
        maxTbReferences: 0,
      },
      diagnostics: [],
    },
  };
}

function mergeCompletedResults(
  completedResults: ReadonlyMap<string, UnitResult> | undefined,
  skippedResults: UnitResult[],
): Map<string, UnitResult> {
  const merged = new Map(completedResults);

  for (const result of skippedResults) {
    if (result.target?.trim()) {
      merged.set(unitKey(result), result);
    }
  }

  return merged;
}

function resolveJobOrder(
  jobUnits: JobUnit[],
  taskUnits: JobUnit[],
  currentUnits: JobUnit[],
): JobUnit[] {
  if (jobUnits.length === 0) {
    return taskUnits;
  }

  const jobUnitKeys = new Set(jobUnits.map(unitKey));
  const allCurrentUnitsExist = currentUnits.every((unit) => jobUnitKeys.has(unitKey(unit)));

  return allCurrentUnitsExist ? jobUnits : taskUnits;
}

function unitKey(unit: Pick<JobUnit, 'documentId' | 'unitId'>): string {
  return `${unit.documentId}\u0000${unit.unitId}`;
}

function batchResponseId(unit: Pick<JobUnit, 'documentId' | 'unitId'>): string {
  return `${encodeURIComponent(unit.documentId)}#${encodeURIComponent(unit.unitId)}`;
}

function hashCanonicalPayload(entries: Array<[string, unknown]>): string {
  const payload = entries.filter(([, value]) => value !== undefined);

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function compareResourceFingerprint(
  left: { id: string; priority: number },
  right: { id: string; priority: number },
): number {
  return left.priority - right.priority || left.id.localeCompare(right.id);
}

function jobUnitToExternalUnit(unit: {
  unitId: string;
  source: string;
  target?: string;
  context?: string;
  rowNumber?: number;
  metadata?: Record<string, unknown>;
}): ExternalTranslationUnit {
  return {
    id: unit.unitId,
    source: unit.source,
    target: unit.target,
    context: unit.context,
    rowNumber: unit.rowNumber,
    metadata: unit.metadata,
  };
}

function toUnitResult(
  jobId: string,
  unit: TranslationTask['units'][number],
  result: TranslateUnitResult,
): UnitResult {
  return {
    jobId,
    documentId: unit.documentId,
    unitId: unit.unitId,
    sourceHash: unit.sourceHash,
    status: result.status as UnitResultStatus,
    source: unit.source,
    target: result.target,
    error: result.status === 'failed' ? result.error : undefined,
    references: result.references,
    metadata: unit.metadata,
  };
}

function toArtifactRecord(
  jobId: string,
  taskId: string,
  unit: TranslationTask['units'][number],
  result: UnitResult,
  artifacts?: PreparedTranslationArtifacts,
): ArtifactRecord {
  return {
    job: jobId,
    task: taskId,
    doc: unit.documentId,
    unit: unit.unitId,
    tm: artifacts?.tm,
    tb: artifacts?.tb,
    prompt: artifacts?.prompt,
    result,
    error: result.error,
    at: new Date().toISOString(),
  };
}

function buildTranslateUnitsResult(results: TranslateUnitResult[]): TranslateUnitsResult {
  return {
    summary: {
      total: results.length,
      translated: results.filter((result) => result.status === 'translated').length,
      skipped: results.filter((result) => result.status === 'skipped').length,
      failed: results.filter((result) => result.status === 'failed').length,
    },
    results,
  };
}

function mergeMTOptions(
  defaults?: LocalizationEngineOptions['mt'],
  overrides?: LocalizationEngineOptions['mt'],
): NonNullable<LocalizationEngineOptions['mt']> {
  return {
    providerId: overrides?.providerId ?? defaults?.providerId,
    model: overrides?.model ?? defaults?.model,
    reasoningEffort: overrides?.reasoningEffort ?? defaults?.reasoningEffort,
    systemPrompt: overrides?.systemPrompt ?? defaults?.systemPrompt,
    temperature: overrides?.temperature ?? defaults?.temperature,
  };
}
