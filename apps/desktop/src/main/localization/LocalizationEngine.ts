import type { Segment } from '@cat/core/models';
import { normalizeProjectAIModel } from '@cat/core/project';
import { TagValidator } from '@cat/core/qa';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { CATDatabase } from '@cat/db';
import { TBService } from '../services/TBService';
import { TMService } from '../services/TMService';
import { SqliteProjectRepository } from '../services/adapters/SqliteProjectRepository';
import { SqliteSettingsRepository } from '../services/adapters/SqliteSettingsRepository';
import { SqliteTBRepository } from '../services/adapters/SqliteTBRepository';
import { SqliteTMRepository } from '../services/adapters/SqliteTMRepository';
import { DefaultAIRuntimeConfigProvider } from '../services/modules/ai/AIRuntimeConfigService';
import { AIProviderCatalogService } from '../services/modules/ai/AIProviderCatalogService';
import { resolveBatchTargetScope } from '../services/modules/ai/translationTargetScope';
import { AIProviderTransport } from '../services/providers/AIProviderTransport';
import type { AIRuntimeConfigProvider, AITransport } from '../services/ports';
import { runBounded } from './RequestScheduler';
import { MTModule, type ResolvedMTConfig } from './modules/MTModule';
import { TBModule, mapTBEngineReferences } from './modules/TBModule';
import { TMModule, mapTMEngineReferences } from './modules/TMModule';
import { translateSpreadsheetFile } from './spreadsheetFileAdapter';
import { createTransientSegment } from './transientSegment';
import type {
  ArtifactRecord,
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
  artifacts: PreparedTranslationArtifacts;
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

    const targetScope = resolveBatchTargetScope(
      this.options.defaultTargetScope,
    ) as LocalizationTargetScope;
    const preparedUnits = task.units.map((unit, index) =>
      this.prepareUnit(jobUnitToExternalUnit(unit), index, project, targetScope),
    );
    const hasTranslatableUnits = preparedUnits.some((prepared) => prepared.kind === 'translatable');
    const mtOptions = mergeMTOptions(this.options.mt, undefined);
    const mtConfig = hasTranslatableUnits
      ? await this.mtModule.resolveConfig(project, mtOptions)
      : undefined;
    const results: UnitResult[] = [];
    const artifacts: ArtifactRecord[] = [];

    for (let index = 0; index < preparedUnits.length; index += 1) {
      const jobUnit = task.units[index];
      const prepared = preparedUnits[index];

      if (!jobUnit || !prepared) {
        continue;
      }

      if (prepared.kind === 'skipped') {
        const result = toUnitResult(context.job.id, jobUnit, prepared.result);
        results.push(result);
        artifacts.push(toArtifactRecord(context.job.id, task.taskId, jobUnit, result));
        continue;
      }

      if (!mtConfig) {
        throw new Error('MT configuration was not resolved for a translatable unit.');
      }

      const translated = await this.translatePreparedUnitWithArtifacts({
        unit: prepared.unit,
        segment: prepared.segment,
        project,
        mtConfig,
        mtOptions,
        includeReferences: false,
      });
      const result = toUnitResult(context.job.id, jobUnit, translated.result);

      results.push(result);
      artifacts.push(
        toArtifactRecord(context.job.id, task.taskId, jobUnit, result, translated.artifacts),
      );
    }

    return { results, artifacts };
  }

  public async translateFile(input: TranslateFileInput): Promise<TranslateFileResult> {
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
  }): Promise<PreparedTranslationResult> {
    const source = params.unit.source;
    const projectType = params.project.projectType ?? 'translation';
    const references =
      projectType === 'translation'
        ? await this.resolveReferences(params.project.id, params.segment)
        : emptyReferences();

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
      artifacts: {
        tm: references.tm,
        tb: references.tb,
        prompt,
      },
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
}

function emptyReferences(): ResolvedReferences {
  return {
    engineReferences: {
      tm: [],
      tb: [],
    },
    tm: {
      unitId: '',
      segmentId: '',
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
      unitId: '',
      segmentId: '',
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
