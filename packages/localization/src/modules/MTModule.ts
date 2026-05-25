import type { Segment } from '@cat/core/models';
import {
  DEFAULT_PROJECT_AI_MODEL,
  buildAIWindowModePromptBundle,
  buildAITextPromptBundle,
  normalizeProjectAIModel,
  normalizeProjectType,
  parseAIWindowModeResponse,
  type Project,
  type ProjectType,
} from '@cat/core/project';
import { TagValidator } from '@cat/core/qa';
import { parseEditorTextToTokens, serializeTokensToEditorText } from '@cat/core/tag';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { AIProviderCatalogService } from '../providers/AIProviderCatalogService';
import type { AIRuntimeConfigProvider, AITransport, ReasoningEffort } from '../ports';
import type { PromptArtifact, TBArtifact, TMArtifact } from '../artifacts';
import type { MTModuleOptions as LocalizationMTOptions } from '../types';
import type {
  ComposeBatchPromptInput,
  ComposePromptInput,
  MTBatchTranslateResult,
  MTModuleDependencies,
  MTTranslateResult,
  PreparedBatchPromptInput,
  PreparedPromptInput,
  PromptMTConfig,
  ResolvedMTConfig,
  TranslatePreparedBatchPromptInput,
  TranslatePreparedPromptInput,
} from './MTModuleTypes';
export type {
  ComposeBatchPromptInput,
  ComposePromptInput,
  MTBatchCurrentUnitInput,
  MTBatchTranslateResult,
  MTBatchUnitResult,
  MTModuleDependencies,
  MTTranslateResult,
  PreparedBatchPromptInput,
  PreparedPromptInput,
  PromptMTConfig,
  ResolvedMTConfig,
  TranslatePreparedBatchPromptInput,
  TranslatePreparedPromptInput,
} from './MTModuleTypes';

type SegmentLanguageMeta = Segment['meta'] & {
  sourceLanguage?: unknown;
  targetLanguage?: unknown;
};

export class MTModule {
  private readonly providerCatalogService: Pick<
    AIProviderCatalogService,
    'listProviders' | 'resolveProviderConfig'
  >;
  private readonly aiRuntimeConfigProvider: AIRuntimeConfigProvider;
  private readonly aiTransport: AITransport;
  private readonly tagValidator: TagValidator;

  constructor(options: MTModuleDependencies) {
    this.providerCatalogService = options.providerCatalogService;
    this.aiRuntimeConfigProvider = options.aiRuntimeConfigProvider;
    this.aiTransport = options.aiTransport;
    this.tagValidator = options.tagValidator ?? new TagValidator();
  }

  async resolveConfig(
    project: Project,
    mtOptions?: LocalizationMTOptions,
    providerOverride?: string,
  ): Promise<ResolvedMTConfig> {
    const providerId = providerOverride ?? mtOptions?.providerId ?? project.aiModel;
    const { provider, apiKey } = this.providerCatalogService.resolveProviderConfig(providerId);
    const model = mtOptions?.model ?? provider.model;
    const reasoningEffort = await this.resolveReasoningEffort(model, mtOptions?.reasoningEffort);

    return {
      provider,
      apiKey,
      model,
      reasoningEffort,
    };
  }

  async resolvePromptConfig(
    project: Project,
    mtOptions?: LocalizationMTOptions,
    providerOverride?: string,
  ): Promise<PromptMTConfig> {
    const normalizedProviderId = normalizeProjectAIModel(
      providerOverride ?? mtOptions?.providerId ?? project.aiModel,
    );
    const providers = this.providerCatalogService.listProviders();
    const provider =
      providers.find((candidate) => candidate.id === normalizedProviderId) ??
      providers.find((candidate) => candidate.id === DEFAULT_PROJECT_AI_MODEL) ??
      providers[0];

    if (!provider) {
      throw new Error('No AI providers are available');
    }

    const model = mtOptions?.model ?? provider.model;

    return {
      provider,
      model,
      reasoningEffort: await this.resolveReasoningEffort(model, mtOptions?.reasoningEffort),
    };
  }

  async composePrompt(input: ComposePromptInput): Promise<PromptArtifact> {
    const config = await this.resolvePromptConfig(
      input.project,
      input.mtOptions,
      input.providerOverride,
    );
    const meta = input.segment.meta as SegmentLanguageMeta;
    return this.composePreparedPrompt({
      ...input,
      baseUrl: config.provider.baseUrl,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      provider: config.provider,
      srcLang: meta.sourceLanguage ? String(meta.sourceLanguage) : input.project.srcLang,
      tgtLang: meta.targetLanguage ? String(meta.targetLanguage) : input.project.tgtLang,
    });
  }

  async composeBatchPrompt(input: ComposeBatchPromptInput): Promise<PromptArtifact> {
    const config = await this.resolvePromptConfig(
      input.project,
      input.mtOptions,
      input.providerOverride,
    );
    const meta = input.current[0]?.segment.meta as SegmentLanguageMeta | undefined;
    return this.composePreparedBatchPrompt({
      ...input,
      baseUrl: config.provider.baseUrl,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      provider: config.provider,
      srcLang: meta?.sourceLanguage ? String(meta.sourceLanguage) : input.project.srcLang,
      tgtLang: meta?.targetLanguage ? String(meta.targetLanguage) : input.project.tgtLang,
    });
  }

  composePreparedPrompt(input: PreparedPromptInput): PromptArtifact {
    const promptParams = this.buildPromptParams(input);
    const promptBundle = buildAITextPromptBundle(promptParams.projectType, {
      srcLang: input.srcLang,
      tgtLang: input.tgtLang,
      projectPrompt: promptParams.projectPrompt,
      sourceText: promptParams.sourceText,
      sourceTagPreservedText: promptParams.sourceTagPreservedText,
      context: promptParams.context,
      validationFeedback: promptParams.validationFeedback,
      ...promptParams.references,
    });

    return {
      unitId: input.unitId,
      provider: {
        id: input.provider?.id ?? null,
        name: input.provider?.name ?? null,
        baseUrl: input.baseUrl,
      },
      model: input.model,
      reasoningEffort: input.reasoningEffort ?? null,
      projectPrompt: promptParams.projectPrompt,
      projectType: promptParams.projectType,
      sourcePayload: promptBundle.sourcePayload,
      tmPromptBlock: promptBundle.sections.tmPromptBlock,
      concordancePromptBlock: promptBundle.sections.concordancePromptBlock,
      tbPromptBlock: promptBundle.sections.tbPromptBlock,
      referencePromptBlock: promptBundle.sections.referencePromptBlock,
      systemPrompt: promptBundle.systemPrompt,
      userPrompt: promptBundle.userPrompt,
      promptChars: {
        system: promptBundle.systemPrompt.length,
        user: promptBundle.userPrompt.length,
        total: promptBundle.systemPrompt.length + promptBundle.userPrompt.length,
      },
    };
  }

  composePreparedBatchPrompt(input: PreparedBatchPromptInput): PromptArtifact {
    const promptParams = this.buildBatchPromptParams(input);
    const promptBundle = buildAIWindowModePromptBundle({
      projectType: promptParams.projectType,
      srcLang: input.srcLang,
      tgtLang: input.tgtLang,
      projectPrompt: promptParams.projectPrompt,
      requestMode: input.requestMode,
      currentSegments: promptParams.currentSegments,
      previousContext: input.previousContext,
      nextContext: input.nextContext,
      readOnlyContextRows: input.readOnlyContextRows,
      validationFeedback: promptParams.validationFeedback,
    });
    const sourcePayload = promptParams.currentSegments
      .map((segment) => `${segment.id}: ${segment.sourcePayload}`)
      .join('\n');

    return {
      unitId: input.taskId,
      provider: {
        id: input.provider?.id ?? null,
        name: input.provider?.name ?? null,
        baseUrl: input.baseUrl,
      },
      model: input.model,
      reasoningEffort: input.reasoningEffort ?? null,
      projectPrompt: promptParams.projectPrompt,
      projectType: promptParams.projectType,
      sourcePayload,
      tmPromptBlock: promptBundle.sections.tmPromptBlock,
      concordancePromptBlock: promptBundle.sections.concordancePromptBlock,
      tbPromptBlock: promptBundle.sections.tbPromptBlock,
      referencePromptBlock: promptBundle.sections.referencePromptBlock,
      systemPrompt: promptBundle.systemPrompt,
      userPrompt: promptBundle.userPrompt,
      promptChars: {
        system: promptBundle.systemPrompt.length,
        user: promptBundle.userPrompt.length,
        total: promptBundle.systemPrompt.length + promptBundle.userPrompt.length,
      },
      batch: {
        mode: input.requestMode === 'window-partial' ? 'window-partial' : 'window',
        taskId: input.taskId,
        currentIds: promptParams.currentSegments.map((segment) => segment.id),
        previousContextCount: input.previousContext.length,
        nextContextCount: input.nextContext.length,
        ...(typeof input.scanWindowCount === 'number'
          ? { scanWindowCount: input.scanWindowCount }
          : {}),
        ...(input.requestMode === 'window-partial'
          ? {
              requestCount: promptParams.currentSegments.length,
              readOnlyContextCount: input.readOnlyContextRows?.length ?? 0,
            }
          : {}),
      },
    };
  }

  async translate(input: TranslatePreparedPromptInput): Promise<MTTranslateResult> {
    const prompt = this.composePreparedPrompt(input);
    const promptParams = this.buildPromptParams(input);
    const maxAttempts = 3;
    let validationFeedback: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptPrompt =
        attempt === 1
          ? prompt
          : this.composePreparedPrompt({
              ...input,
              validationFeedback,
            });
      const response = await this.aiTransport.createResponse({
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        model: input.model,
        reasoningEffort: input.reasoningEffort ?? 'medium',
        systemPrompt: attemptPrompt.systemPrompt,
        userPrompt: attemptPrompt.userPrompt,
      });
      const trimmed = response.content.trim();
      if (!trimmed) {
        throw new Error('AI provider response was empty');
      }

      const targetTokens = parseEditorTextToTokens(trimmed, input.segment.sourceTokens);
      if (promptParams.projectType === 'custom') {
        return { targetTokens, prompt };
      }

      const validationResult = this.tagValidator.validate(input.segment.sourceTokens, targetTokens);
      const errors = validationResult.issues.filter((issue) => issue.severity === 'error');

      if (errors.length === 0) {
        return { targetTokens, prompt };
      }

      if (attempt === maxAttempts) {
        throw new Error(
          `Tag validation failed after ${maxAttempts} attempts: ${errors.map((e) => e.message).join('; ')}`,
        );
      }

      validationFeedback = [
        'Previous translation was invalid.',
        ...errors.map((e) => `- ${e.message}`),
        'Retry by preserving marker content and sequence exactly.',
      ].join('\n');
    }

    throw new Error('Unexpected translation retry failure');
  }

  async translateBatch(input: TranslatePreparedBatchPromptInput): Promise<MTBatchTranslateResult> {
    const prompt = this.composePreparedBatchPrompt(input);
    const promptParams = this.buildBatchPromptParams(input);
    const currentByResponseId = new Map(input.current.map((unit) => [unit.responseId, unit]));
    const maxAttempts = 3;
    let validationFeedback: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptPrompt =
        attempt === 1
          ? prompt
          : this.composePreparedBatchPrompt({
              ...input,
              validationFeedback,
            });
      const response = await this.aiTransport.createResponse({
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        model: input.model,
        reasoningEffort: input.reasoningEffort ?? 'medium',
        systemPrompt: attemptPrompt.systemPrompt,
        userPrompt: attemptPrompt.userPrompt,
      });

      const translations = this.parseBatchResponse(
        response.content,
        input.current.map((unit) => unit.responseId),
      );
      const results = translations.map((translation) => {
        const unit = currentByResponseId.get(translation.id);
        if (!unit) {
          throw new Error(`Unknown translation id: ${translation.id}`);
        }
        return {
          documentId: unit.documentId,
          unitId: unit.unitId,
          responseId: translation.id,
          targetTokens: parseEditorTextToTokens(translation.text, unit.segment.sourceTokens),
        };
      });

      if (promptParams.projectType === 'custom') {
        return { results, prompt: attemptPrompt };
      }

      const validationErrors = results.flatMap((result) => {
        const unit = currentByResponseId.get(result.responseId);
        if (!unit) {
          return [`${result.responseId}: unknown current unit`];
        }
        return this.tagValidator
          .validate(unit.segment.sourceTokens, result.targetTokens)
          .issues.filter((issue) => issue.severity === 'error')
          .map((issue) => `${result.responseId}: ${issue.message}`);
      });

      if (validationErrors.length === 0) {
        return { results, prompt: attemptPrompt };
      }

      if (attempt === maxAttempts) {
        throw new Error(
          `Tag validation failed after ${maxAttempts} attempts: ${validationErrors.join('; ')}`,
        );
      }

      validationFeedback = [
        'Previous Window Mode batch translation was invalid.',
        ...validationErrors.map((error) => `- ${error}`),
        'Retry only the strict JSON response and preserve marker content and sequence exactly.',
      ].join('\n');
    }

    throw new Error('Unexpected batch translation retry failure');
  }

  private buildPromptParams(input: ComposePromptInput & { validationFeedback?: string }): {
    projectPrompt: string;
    projectType: ProjectType;
    sourceText: string;
    sourceTagPreservedText: string;
    context: string;
    validationFeedback?: string;
    references: {
      tmReference?: TMArtifact['selectedReferences']['tmReferences'][number];
      tmReferences?: TMArtifact['selectedReferences']['tmReferences'];
      concordanceReferences?: TMArtifact['selectedReferences']['concordanceReferences'];
      tbReferences?: TBArtifact['selectedReferences'];
    };
  } {
    const sourceText = serializeTokensToDisplayText(input.segment.sourceTokens);
    const sourceTagPreservedText = serializeTokensToEditorText(
      input.segment.sourceTokens,
      input.segment.sourceTokens,
    );
    const context = input.segment.meta?.context ? String(input.segment.meta.context).trim() : '';
    const tmReferences = input.tm.selectedReferences.tmReferences;
    const concordanceReferences = input.tm.selectedReferences.concordanceReferences;
    const tbReferences = input.tb.selectedReferences;

    return {
      projectPrompt:
        input.projectPromptOverride ??
        input.mtOptions?.systemPrompt ??
        input.project.aiPrompt ??
        '',
      projectType: normalizeProjectType(input.project.projectType),
      sourceText,
      sourceTagPreservedText,
      context,
      validationFeedback: input.validationFeedback,
      references: {
        tmReference: tmReferences[0],
        tmReferences: tmReferences.length > 0 ? tmReferences : undefined,
        concordanceReferences: concordanceReferences.length > 0 ? concordanceReferences : undefined,
        tbReferences: tbReferences.length > 0 ? tbReferences : undefined,
      },
    };
  }

  private buildBatchPromptParams(input: ComposeBatchPromptInput & { validationFeedback?: string }): {
    projectPrompt: string;
    projectType: ProjectType;
    validationFeedback?: string;
    currentSegments: Array<{
      id: string;
      sourcePayload: string;
      context?: string;
      tmReferences?: TMArtifact['selectedReferences']['tmReferences'];
      concordanceReferences?: TMArtifact['selectedReferences']['concordanceReferences'];
      tbReferences?: TBArtifact['selectedReferences'];
    }>;
  } {
    const currentSegments = input.current.map((unit) => {
      const sourcePayload = serializeTokensToEditorText(
        unit.segment.sourceTokens,
        unit.segment.sourceTokens,
      );

      const context =
        unit.context ??
        (unit.segment.meta?.context ? String(unit.segment.meta.context).trim() : undefined);
      const tmReferences = unit.tm.selectedReferences.tmReferences;
      const concordanceReferences = unit.tm.selectedReferences.concordanceReferences;
      const tbReferences = unit.tb.selectedReferences;

      return {
        id: unit.responseId,
        sourcePayload,
        context,
        tmReferences: tmReferences.length > 0 ? tmReferences : undefined,
        concordanceReferences:
          concordanceReferences.length > 0 ? concordanceReferences : undefined,
        tbReferences: tbReferences.length > 0 ? tbReferences : undefined,
      };
    });

    return {
      projectPrompt:
        input.projectPromptOverride ??
        input.mtOptions?.systemPrompt ??
        input.project.aiPrompt ??
        '',
      projectType: normalizeProjectType(input.project.projectType),
      validationFeedback: input.validationFeedback,
      currentSegments,
    };
  }

  private parseBatchResponse(content: string, expectedIds: string[]) {
    try {
      return parseAIWindowModeResponse(content, expectedIds);
    } catch (error) {
      if (error instanceof Error) {
        const missing = /^Missing translation id "(.+)"\.$/i.exec(error.message);
        if (missing) {
          throw new Error(`Missing translation id: ${missing[1]}`);
        }
      }
      throw error;
    }
  }

  private async resolveReasoningEffort(
    model: string,
    reasoningEffort?: ReasoningEffort,
  ): Promise<ReasoningEffort> {
    if (reasoningEffort) {
      return reasoningEffort;
    }

    const runtimeConfig = await this.aiRuntimeConfigProvider.getModelConfig(model);
    return runtimeConfig.reasoningEffort;
  }

}
