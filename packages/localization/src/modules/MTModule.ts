import type { Segment } from '@cat/core/models';
import {
  DEFAULT_PROJECT_AI_MODEL,
  buildAIWindowModePromptBundle,
  normalizeProjectAIModel,
  type Project,
} from '@cat/core/project';
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
import { buildBatchPromptParams } from './MTModulePromptParams';
import type {
  ComposeBatchPromptInput,
  MTBatchTranslateResult,
  MTModuleDependencies,
  PreparedBatchPromptInput,
  PromptMTConfig,
  ResolvedMTConfig,
  TranslatePreparedBatchPromptInput,
} from './MTModuleTypes';
export type {
  ComposeBatchPromptInput,
  MTBatchCurrentUnitInput,
  MTBatchTranslateResult,
  MTBatchUnitResult,
  MTModuleDependencies,
  PreparedBatchPromptInput,
  PromptMTConfig,
  ResolvedMTConfig,
  TranslatePreparedBatchPromptInput,
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

  constructor(options: MTModuleDependencies) {
    this.providerCatalogService = options.providerCatalogService;
    this.aiRuntimeConfigProvider = options.aiRuntimeConfigProvider;
    this.aiTransport = options.aiTransport;
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

  async translateBatch(input: TranslatePreparedBatchPromptInput): Promise<MTBatchTranslateResult> {
    const prompt = this.composePreparedBatchPrompt(input);
    const tagPolicy = resolveTagPolicy(input.tagPolicy);

    return processMTBatchResponse({
      input,
      prompt,
      tagPolicy,
      aiTransport: this.aiTransport,
      recordAudit: (context, event) => this.recordAudit(context, event),
    });
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
