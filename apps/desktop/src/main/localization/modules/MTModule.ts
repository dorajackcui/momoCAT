import type { Segment } from '@cat/core/models';
import {
  buildAITextPromptBundle,
  normalizeProjectType,
  type Project,
  type ProjectType,
} from '@cat/core/project';
import { TagValidator } from '@cat/core/qa';
import { serializeTokensToEditorText } from '@cat/core/tag';
import { serializeTokensToDisplayText } from '@cat/core/text';
import {
  AIProviderCatalogService,
  type ResolvedAIProviderConfig,
} from '../../services/modules/ai/AIProviderCatalogService';
import { AITextTranslator } from '../../services/modules/ai/AITextTranslator';
import type { AIRuntimeConfigProvider, AITransport, ReasoningEffort } from '../../services/ports';
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

export interface TranslatePreparedPromptInput extends ComposePromptInput {
  apiKey: string;
  baseUrl: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  srcLang: string;
  tgtLang: string;
  provider?: ResolvedAIProviderConfig['provider'];
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
  private readonly textTranslator: AITextTranslator;

  constructor(options: MTModuleOptions) {
    this.providerCatalogService = options.providerCatalogService;
    this.aiRuntimeConfigProvider = options.aiRuntimeConfigProvider;
    this.textTranslator = new AITextTranslator(
      options.aiTransport,
      options.tagValidator ?? new TagValidator(),
    );
  }

  async resolveConfig(
    project: Project,
    mtOptions?: LocalizationMTOptions,
    providerOverride?: string,
  ): Promise<ResolvedMTConfig> {
    const providerId = providerOverride ?? mtOptions?.providerId ?? project.aiModel;
    const { provider, apiKey } = this.providerCatalogService.resolveProviderConfig(providerId);
    const model = mtOptions?.model ?? provider.model;
    const runtimeConfig = await this.aiRuntimeConfigProvider.getModelConfig(model);

    return {
      provider,
      apiKey,
      model,
      reasoningEffort: mtOptions?.reasoningEffort ?? runtimeConfig.reasoningEffort,
    };
  }

  async composePrompt(input: ComposePromptInput): Promise<PromptArtifact> {
    const config = await this.resolveConfig(input.project, input.mtOptions, input.providerOverride);
    const meta = input.segment.meta as SegmentLanguageMeta;
    return this.composePreparedPrompt({
      ...input,
      apiKey: config.apiKey,
      baseUrl: config.provider.baseUrl,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      provider: config.provider,
      srcLang: meta.sourceLanguage ? String(meta.sourceLanguage) : input.project.srcLang,
      tgtLang: meta.targetLanguage ? String(meta.targetLanguage) : input.project.tgtLang,
    });
  }

  composePreparedPrompt(input: TranslatePreparedPromptInput): PromptArtifact {
    const promptParams = this.buildPromptParams(input);
    const promptBundle = buildAITextPromptBundle(promptParams.projectType, {
      srcLang: input.srcLang,
      tgtLang: input.tgtLang,
      projectPrompt: promptParams.projectPrompt,
      sourceText: promptParams.sourceText,
      sourceTagPreservedText: promptParams.sourceTagPreservedText,
      context: promptParams.context,
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
      tbPromptBlock: promptBundle.sections.tbPromptBlock,
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
    const targetTokens = await this.textTranslator.translateSegment({
      segmentId: input.segment.segmentId,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      model: input.model,
      projectPrompt: promptParams.projectPrompt,
      projectType: promptParams.projectType,
      reasoningEffort: input.reasoningEffort,
      srcLang: input.srcLang,
      tgtLang: input.tgtLang,
      sourceTokens: input.segment.sourceTokens,
      sourceText: promptParams.sourceText,
      sourceTagPreservedText: promptParams.sourceTagPreservedText,
      context: promptParams.context,
      ...promptParams.references,
    });

    return { targetTokens, prompt };
  }

  private buildPromptParams(input: ComposePromptInput): {
    projectPrompt: string;
    projectType: ProjectType;
    sourceText: string;
    sourceTagPreservedText: string;
    context: string;
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
      projectPrompt: input.projectPromptOverride ?? input.mtOptions?.systemPrompt ?? input.project.aiPrompt ?? '',
      projectType: normalizeProjectType(input.project.projectType),
      sourceText,
      sourceTagPreservedText,
      context,
      references: {
        tmReference: tmReferences[0],
        tmReferences: tmReferences.length > 0 ? tmReferences : undefined,
        concordanceReferences:
          concordanceReferences.length > 0 ? concordanceReferences : undefined,
        tbReferences: tbReferences.length > 0 ? tbReferences : undefined,
      },
    };
  }
}
