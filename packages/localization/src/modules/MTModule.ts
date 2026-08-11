import type { Segment } from '@cat/core/models';
import {
  DEFAULT_PROJECT_AI_MODEL,
  buildAIWindowModePromptBundle,
  buildAITextPromptBundle,
  normalizeProjectAIModel,
  type Project,
} from '@cat/core/project';
import { TagValidator } from '@cat/core/qa';
import { parseEditorTextToTokens } from '@cat/core/tag';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { AIProviderCatalogService } from '../providers/AIProviderCatalogService';
import type { AIRuntimeConfigProvider, AITransport, ReasoningEffort } from '../ports';
import type { PromptArtifact } from '../artifacts';
import {
  type TranslationAuditContext,
  type TranslationAuditEvent,
} from '../audit/TranslationAudit';
import type { MTModuleOptions as LocalizationMTOptions } from '../types';
import { resolveTagPolicy } from '../tagPolicy';
import { processMTBatchResponse } from './MTBatchResponseProcessor';
import { buildBatchPromptParams, buildPromptParams } from './MTModulePromptParams';
import type {
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

  private recordAudit(
    context: TranslationAuditContext | undefined,
    event: TranslationAuditEvent,
  ): void {
    try {
      context?.sink.record(event);
    } catch {
      // Audit is observational and must not affect translation behavior.
    }
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
    const promptParams = buildPromptParams(input);
    const promptBundle = buildAITextPromptBundle(promptParams.projectType, {
      srcLang: input.srcLang,
      tgtLang: input.tgtLang,
      projectPrompt: promptParams.projectPrompt,
      sourceText: promptParams.sourceText,
      sourceTagPreservedText: promptParams.sourceTagPreservedText,
      context: promptParams.context,
      currentTranslationPayload: promptParams.currentTranslationPayload,
      refinementInstruction: promptParams.refinementInstruction,
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
    const promptParams = buildBatchPromptParams(input);
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
        responseIdMap: input.current.map((unit) => ({
          responseId: unit.responseId,
          documentId: unit.documentId,
          unitId: unit.unitId,
        })),
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
    const promptParams = buildPromptParams(input);
    const tagPolicy = resolveTagPolicy(input.tagPolicy);
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

      const targetTokens = parseEditorTextToTokens(trimmed, input.segment.sourceTokens, {
        tagPolicy,
      });
      if (promptParams.projectType === 'custom' || tagPolicy === 'none') {
        return { targetTokens, prompt: attemptPrompt };
      }

      const validationResult = this.tagValidator.validate(input.segment.sourceTokens, targetTokens);
      const errors = validationResult.issues.filter((issue) => issue.severity === 'error');

      if (errors.length === 0) {
        return { targetTokens, prompt: attemptPrompt };
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
    const promptParams = buildBatchPromptParams(input);
    const tagPolicy = resolveTagPolicy(input.tagPolicy);

    return processMTBatchResponse({
      input,
      prompt,
      projectType: promptParams.projectType,
      tagPolicy,
      aiTransport: this.aiTransport,
      tagValidator: this.tagValidator,
      recordAudit: (context, event) => this.recordAudit(context, event),
      repairInvalidResult: (unit, parsedResult, validationFeedback) =>
        this.repairInvalidBatchResult(input, unit, parsedResult, validationFeedback),
    });
  }

  private async repairInvalidBatchResult(
    input: TranslatePreparedBatchPromptInput,
    unit: MTBatchCurrentUnitInput,
    parsedResult: MTBatchUnitResult,
    validationFeedback: string,
  ): Promise<MTBatchUnitResult> {
    const repaired = await this.translate({
      project: input.project,
      unitId: unit.unitId,
      segment: unit.segment,
      tm: unit.tm,
      tb: unit.tb,
      tagPolicy: input.tagPolicy,
      mtOptions: input.mtOptions,
      providerOverride: input.providerOverride,
      projectPromptOverride: input.projectPromptOverride,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      provider: input.provider,
      srcLang: input.srcLang,
      tgtLang: input.tgtLang,
      context: unit.context,
      validationFeedback,
      currentTranslationPayload: serializeTokensToDisplayText(parsedResult.targetTokens),
      refinementInstruction:
        'Repair this translation only. Preserve the existing translation where possible, but fix the validation issues below.',
    });

    return {
      documentId: unit.documentId,
      unitId: unit.unitId,
      responseId: parsedResult.responseId,
      targetTokens: repaired.targetTokens,
      prompt: repaired.prompt,
    };
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
