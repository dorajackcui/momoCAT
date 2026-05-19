import type { Segment } from '@cat/core/models';
import {
  normalizeProjectAIModel,
  type PromptConcordanceReference,
  type PromptTBReference,
  type PromptTMReference,
} from '@cat/core/project';
import { TagValidator } from '@cat/core/qa';
import { serializeTokensToEditorText } from '@cat/core/tag';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { CATDatabase } from '@cat/db';
import { TBService } from '../services/TBService';
import { TMService, type TMMatch } from '../services/TMService';
import { SqliteProjectRepository } from '../services/adapters/SqliteProjectRepository';
import { SqliteSettingsRepository } from '../services/adapters/SqliteSettingsRepository';
import { SqliteTBRepository } from '../services/adapters/SqliteTBRepository';
import { SqliteTMRepository } from '../services/adapters/SqliteTMRepository';
import { DefaultAIRuntimeConfigProvider } from '../services/modules/ai/AIRuntimeConfigService';
import { AIProviderCatalogService } from '../services/modules/ai/AIProviderCatalogService';
import { AITextTranslator } from '../services/modules/ai/AITextTranslator';
import { resolveBatchTargetScope } from '../services/modules/ai/translationTargetScope';
import { AIProviderTransport } from '../services/providers/AIProviderTransport';
import type { AIRuntimeConfigProvider, AITransport } from '../services/ports';
import { runBounded } from './RequestScheduler';
import { translateSpreadsheetFile } from './spreadsheetFileAdapter';
import { createTransientSegment } from './transientSegment';
import type {
  EngineTMReference,
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

const MAX_TM_PROMPT_REFERENCES = 3;
const MAX_CONCORDANCE_PROMPT_REFERENCES = 3;
const MAX_TB_PROMPT_REFERENCES = 100;
const MAX_ENGINE_TM_REFERENCES = 10;
const MAX_ENGINE_TB_REFERENCES = 100;

export interface LocalizationEngineConstructorOptions extends LocalizationEngineOptions {
  dbPath: string;
  aiTransport?: AITransport;
  aiRuntimeConfigProvider?: AIRuntimeConfigProvider;
}

interface ResolvedReferences {
  engineReferences: TranslateUnitReferences;
  promptReferences: {
    tmReference?: PromptTMReference;
    tmReferences?: PromptTMReference[];
    concordanceReferences?: PromptConcordanceReference[];
    tbReferences?: PromptTBReference[];
  };
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
  private readonly textTranslator: AITextTranslator;
  private readonly options: LocalizationEngineConstructorOptions;

  constructor(
    db: CATDatabase,
    options: LocalizationEngineConstructorOptions,
  ) {
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
    this.textTranslator = new AITextTranslator(aiTransport, new TagValidator());
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
      const { provider, apiKey } = this.providerCatalogService.resolveProviderConfig(providerId);
      model = this.options.mt?.model ?? provider.model;
      apiKeySet = apiKey.trim().length > 0;
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

    const providerId =
      input.options?.providerOverride ??
      input.options?.mt?.providerId ??
      this.options.mt?.providerId ??
      project.aiModel;
    const { provider, apiKey } = this.providerCatalogService.resolveProviderConfig(providerId);
    const model = input.options?.mt?.model ?? this.options.mt?.model ?? provider.model;
    const runtimeConfig = await this.aiRuntimeConfigProvider.getModelConfig(model);
    const reasoningEffort =
      input.options?.mt?.reasoningEffort ??
      this.options.mt?.reasoningEffort ??
      runtimeConfig.reasoningEffort;
    const systemPrompt =
      input.options?.mt?.systemPrompt ?? this.options.mt?.systemPrompt;

    const scheduledResults = await runBounded(
      preparedUnits,
      async (prepared) => {
        if (prepared.kind === 'skipped') {
          return prepared.result;
        }

        return this.translatePreparedUnit({
          unit: prepared.unit,
          segment: prepared.segment,
          project,
          apiKey,
          baseUrl: provider.baseUrl,
          model,
          reasoningEffort,
          includeReferences: Boolean(input.options?.includeReferences),
          systemPrompt,
        });
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

  private async translatePreparedUnit(params: {
    unit: ExternalTranslationUnit;
    segment: Segment;
    project: ProjectRecord;
    apiKey: string;
    baseUrl: string;
    model: string;
    reasoningEffort: NonNullable<LocalizationEngineOptions['mt']>['reasoningEffort'];
    includeReferences: boolean;
    systemPrompt?: string;
  }): Promise<TranslateUnitResult> {
    const source = params.unit.source;
    const projectType = params.project.projectType ?? 'translation';
    const references =
      projectType === 'translation'
        ? await this.resolveReferences(params.project.id, params.segment)
        : emptyReferences();
    const sourceText = serializeTokensToDisplayText(params.segment.sourceTokens);
    const sourceTagPreservedText = serializeTokensToEditorText(
      params.segment.sourceTokens,
      params.segment.sourceTokens,
    );
    const context = params.segment.meta?.context ? String(params.segment.meta.context).trim() : '';

    const targetTokens = await this.textTranslator.translateSegment({
      segmentId: params.segment.segmentId,
      apiKey: params.apiKey,
      baseUrl: params.baseUrl,
      model: params.model,
      projectPrompt: params.systemPrompt ?? params.project.aiPrompt ?? '',
      projectType,
      reasoningEffort: params.reasoningEffort,
      srcLang: params.unit.sourceLanguage ?? params.project.srcLang,
      tgtLang: params.unit.targetLanguage ?? params.project.tgtLang,
      sourceTokens: params.segment.sourceTokens,
      sourceText,
      sourceTagPreservedText,
      context,
      ...references.promptReferences,
    });

    return {
      id: params.unit.id,
      source,
      target: serializeTokensToDisplayText(targetTokens),
      status: 'translated',
      references: params.includeReferences ? references.engineReferences : undefined,
      metadata: params.unit.metadata,
    };
  }

  private async resolveReferences(
    projectId: number,
    segment: Segment,
  ): Promise<ResolvedReferences> {
    const [tmMatches, tbMatches] = await Promise.all([
      this.tmService.findMatches(projectId, segment),
      this.tbService.findMatches(projectId, segment),
    ]);
    const tmReferences = tmMatches.slice(0, MAX_ENGINE_TM_REFERENCES).map(mapTMReference);
    const tbReferences = tbMatches.slice(0, MAX_ENGINE_TB_REFERENCES).map((match) => ({
      tbName: match.tbName,
      srcTerm: match.srcTerm,
      tgtTerm: match.tgtTerm,
      note: match.note ?? null,
    }));
    const promptTmReferences = tmMatches
      .filter((match) => match.kind === 'tm')
      .slice(0, MAX_TM_PROMPT_REFERENCES)
      .map((match) => ({
        similarity: match.similarity,
        tmName: match.tmName,
        sourceText: serializeTokensToDisplayText(match.sourceTokens),
        targetText: serializeTokensToDisplayText(match.targetTokens),
      }));
    const promptConcordanceReferences = tmMatches
      .filter((match) => match.kind === 'concordance')
      .slice(0, MAX_CONCORDANCE_PROMPT_REFERENCES)
      .map((match) => ({
        tmName: match.tmName,
        matchedSourceText: match.matchedSourceText,
        sourceText: serializeTokensToDisplayText(match.sourceTokens),
        targetText: serializeTokensToDisplayText(match.targetTokens),
      }));
    const promptTbReferences = tbReferences
      .slice(0, MAX_TB_PROMPT_REFERENCES)
      .map(({ srcTerm, tgtTerm, note }) => ({ srcTerm, tgtTerm, note }));

    return {
      engineReferences: {
        tm: tmReferences,
        tb: tbReferences,
      },
      promptReferences: {
        tmReference: promptTmReferences[0],
        tmReferences: promptTmReferences.length > 0 ? promptTmReferences : undefined,
        concordanceReferences:
          promptConcordanceReferences.length > 0 ? promptConcordanceReferences : undefined,
        tbReferences: promptTbReferences.length > 0 ? promptTbReferences : undefined,
      },
    };
  }
}

function emptyReferences(): ResolvedReferences {
  return {
    engineReferences: {
      tm: [],
      tb: [],
    },
    promptReferences: {},
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

function mapTMReference(match: TMMatch): EngineTMReference {
  const base = {
    kind: match.kind,
    rank: match.rank,
    tmName: match.tmName,
    sourceText: serializeTokensToDisplayText(match.sourceTokens),
    targetText: serializeTokensToDisplayText(match.targetTokens),
  };

  if (match.kind === 'tm') {
    return {
      ...base,
      kind: 'tm',
      similarity: match.similarity,
    };
  }

  return {
    ...base,
    kind: 'concordance',
    matchedSourceText: match.matchedSourceText,
  };
}
