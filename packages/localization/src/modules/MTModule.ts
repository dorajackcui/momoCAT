import type { Segment } from '@cat/core/models';
import {
  DEFAULT_PROJECT_AI_MODEL,
  buildAITextPromptBundle,
  normalizeProjectAIModel,
  normalizeProjectType,
  type Project,
  type ProjectType,
} from '@cat/core/project';
import { TagValidator } from '@cat/core/qa';
import { parseEditorTextToTokens, serializeTokensToEditorText } from '@cat/core/tag';
import { serializeTokensToDisplayText } from '@cat/core/text';
import {
  AIProviderCatalogService,
  type ResolvedAIProviderConfig,
} from '../providers/AIProviderCatalogService';
import type { AIRuntimeConfigProvider, AITransport, ReasoningEffort } from '../ports';
import type { PromptArtifact, TBArtifact, TMArtifact } from '../artifacts';
import type { MTModuleOptions as LocalizationMTOptions } from '../types';

export interface MTModuleOptions {
  providerCatalogService: AIProviderCatalogService;
  aiRuntimeConfigProvider: AIRuntimeConfigProvider;
  aiTransport: AITransport;
  tagValidator?: TagValidator;
}

export interface ComposePromptInput {
  unitId: string;
  project: Project;
  segment: Segment;
  tm: TMArtifact;
  tb: TBArtifact;
  mtOptions?: LocalizationMTOptions;
  providerOverride?: string;
  projectPromptOverride?: string;
}

export interface ResolvedMTConfig {
  provider: ResolvedAIProviderConfig['provider'];
  apiKey: string;
  model: string;
  reasoningEffort: ReasoningEffort;
}

export interface PromptMTConfig {
  provider: ResolvedAIProviderConfig['provider'];
  model: string;
  reasoningEffort: ReasoningEffort;
}

export interface PreparedPromptInput extends ComposePromptInput {
  baseUrl: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  srcLang: string;
  tgtLang: string;
  provider?: ResolvedAIProviderConfig['provider'];
  validationFeedback?: string;
}

export interface TranslatePreparedPromptInput extends PreparedPromptInput {
  apiKey: string;
}

export interface MTTranslateResult {
  targetTokens: Segment['targetTokens'];
  prompt: PromptArtifact;
}

type SegmentLanguageMeta = Segment['meta'] & {
  sourceLanguage?: unknown;
  targetLanguage?: unknown;
};

export class MTModule {
  private readonly providerCatalogService: AIProviderCatalogService;
  private readonly aiRuntimeConfigProvider: AIRuntimeConfigProvider;
  private readonly aiTransport: AITransport;
  private readonly tagValidator: TagValidator;

  constructor(options: MTModuleOptions) {
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

      this.assertChangedTranslation(trimmed, promptParams.sourceText, prompt.sourcePayload, {
        projectType: promptParams.projectType,
        srcLang: input.srcLang,
        tgtLang: input.tgtLang,
      });

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

  private assertChangedTranslation(
    trimmed: string,
    sourceText: string,
    sourcePayload: string,
    context: {
      projectType: ProjectType;
      srcLang: string;
      tgtLang: string;
    },
  ): void {
    const allowUnchanged = context.projectType === 'review' || context.projectType === 'custom';
    if (allowUnchanged || context.srcLang === context.tgtLang) {
      return;
    }

    if (trimmed === sourceText.trim() || trimmed === sourcePayload.trim()) {
      throw new Error(`Model returned source unchanged: ${trimmed}`);
    }
  }
}
