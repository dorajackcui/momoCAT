import { createHash } from 'crypto';
import type { Segment } from '@cat/core/models';
import { normalizeProjectAIModel } from '@cat/core/project';
import { TagValidator } from '@cat/core/qa';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { CATDatabase } from '@cat/db';
import { MTModule, type ResolvedMTConfig } from './modules/MTModule';
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
import { resolveBatchTargetScope } from './translationTargetScope';
import { AIProviderTransport } from './providers/AIProviderTransport';
import type { AIRuntimeConfigProvider, AITransport } from './ports';
import { runBounded } from './RequestScheduler';
import { translateSpreadsheetFileJob } from './fileTranslationJobAdapter';
import { translateSpreadsheetFile } from './spreadsheetFileAdapter';
import { createTransientSegment } from './transientSegment';
import { unitKey } from './requestModes/shared/unitIdentity';
import {
  buildTranslateUnitsResult,
  jobUnitToExternalUnit,
  toArtifactRecord,
  toUnitResult,
} from './requestModes/shared/results';
import {
  emptyReferencesForUnit,
  resolveRequestModeReferences,
} from './requestModes/shared/references';
import type {
  PreparedTranslatableJobUnit,
  PreparedTranslationArtifacts,
  ResolvedReferences,
} from './requestModes/types';
import { WindowModeSequentialBatchStrategy } from './requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy';
import type {
  ArtifactRecord,
  TaskExecutionContext,
  TaskExecutionResult,
  TranslationTask,
  TranslationTaskExecutor,
  UnitResult,
} from './job/types';
import type {
  ExternalTranslationUnit,
  LocalizationEngineOptions,
  LocalizationEngineProfile,
  LocalizationMode,
  LocalizationTargetScope,
  TranslateFileInput,
  TranslateFileResult,
  TranslateUnitResult,
  TranslateUnitsInput,
  TranslateUnitsResult,
} from './types';

export interface LocalizationEngineConstructorOptions extends LocalizationEngineOptions {
  dbPath: string;
  aiTransport?: AITransport;
  aiRuntimeConfigProvider?: AIRuntimeConfigProvider;
}

interface PreparedTranslationResult {
  result: TranslateUnitResult;
  artifacts?: PreparedTranslationArtifacts;
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
  private readonly windowModeStrategy: WindowModeSequentialBatchStrategy;
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
    this.windowModeStrategy = new WindowModeSequentialBatchStrategy({
      tmModule: this.tmModule,
      tbModule: this.tbModule,
      mtModule: this.mtModule,
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
    const translatableUnits: PreparedTranslatableJobUnit[] = [];

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

      translatableUnits.push({ jobUnit, segment: prepared.segment });
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
    const translated = await this.windowModeStrategy.translate({
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
    return resolveRequestModeReferences({
      projectId,
      segment,
      tmModule: this.tmModule,
      tbModule: this.tbModule,
    });
  }

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
