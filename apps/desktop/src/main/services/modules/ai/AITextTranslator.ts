import {
  buildAITextPromptBundle,
  normalizeProjectType,
  type PromptConcordanceReference,
  type ProjectType,
  type PromptTBReference,
  type PromptTMReference,
} from '@cat/core/project';
import type { Token } from '@cat/core/models';
import { parseEditorTextToTokens, type TagPolicy } from '@cat/core/tag';
import type { AITransport, ReasoningEffort } from '../../ports';
import { logAIPromptDebug } from './promptDebug';

export interface TranslateDebugMeta {
  systemPrompt?: string;
  userPrompt?: string;
  requestId?: string;
  status?: number;
  endpoint?: string;
  model?: string;
  rawResponseText?: string;
  responseContent?: string;
}

export interface TranslateSegmentParams {
  segmentId?: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  projectPrompt?: string;
  projectType?: ProjectType;
  reasoningEffort?: ReasoningEffort;
  srcLang: string;
  tgtLang: string;
  tagPolicy?: TagPolicy;
  sourceTokens: Token[];
  sourceText: string;
  sourceTagPreservedText: string;
  context?: string;
  currentTranslationPayload?: string;
  refinementInstruction?: string;
  tmReference?: PromptTMReference;
  tmReferences?: PromptTMReference[];
  concordanceReferences?: PromptConcordanceReference[];
  tbReferences?: PromptTBReference[];
}

interface TranslateTextParams {
  apiKey: string;
  baseUrl: string;
  model: string;
  projectPrompt?: string;
  projectType?: ProjectType;
  reasoningEffort?: ReasoningEffort;
  srcLang: string;
  tgtLang: string;
  sourceText: string;
  sourceTagPreservedText?: string;
  context?: string;
  currentTranslationPayload?: string;
  refinementInstruction?: string;
  tmReference?: PromptTMReference;
  tmReferences?: PromptTMReference[];
  concordanceReferences?: PromptConcordanceReference[];
  tbReferences?: PromptTBReference[];
  debug?: TranslateDebugMeta;
  promptDebugFlow?: 'segment' | 'refine' | 'test';
  promptDebugAttempt?: number;
  promptDebugSegmentId?: string;
}

export class AITextTranslator {
  constructor(private readonly transport: AITransport) {}

  public async translateSegment(params: TranslateSegmentParams): Promise<Token[]> {
    const tagPolicy = params.tagPolicy ?? 'default';
    const normalizedType = normalizeProjectType(params.projectType);
    const translatedText = await this.translateText({
      apiKey: params.apiKey,
      baseUrl: params.baseUrl,
      model: params.model,
      projectPrompt: params.projectPrompt,
      projectType: normalizedType,
      reasoningEffort: params.reasoningEffort,
      srcLang: params.srcLang,
      tgtLang: params.tgtLang,
      sourceText: params.sourceText,
      sourceTagPreservedText: params.sourceTagPreservedText,
      context: params.context,
      currentTranslationPayload: params.currentTranslationPayload,
      refinementInstruction: params.refinementInstruction,
      tmReference: params.tmReference,
      tmReferences: params.tmReferences,
      concordanceReferences: params.concordanceReferences,
      tbReferences: params.tbReferences,
      promptDebugFlow: params.refinementInstruction ? 'refine' : 'segment',
      promptDebugSegmentId: params.segmentId,
      promptDebugAttempt: 1,
    });

    return parseEditorTextToTokens(translatedText, params.sourceTokens, { tagPolicy });
  }

  public async translateText(params: TranslateTextParams): Promise<string> {
    const normalizedType = normalizeProjectType(params.projectType);
    const promptBundle = buildAITextPromptBundle(normalizedType, {
      srcLang: params.srcLang,
      tgtLang: params.tgtLang,
      projectPrompt: params.projectPrompt,
      sourceText: params.sourceText,
      sourceTagPreservedText: params.sourceTagPreservedText,
      context: params.context,
      currentTranslationPayload: params.currentTranslationPayload,
      refinementInstruction: params.refinementInstruction,
      tmReference: params.tmReference,
      tmReferences: params.tmReferences,
      concordanceReferences: params.concordanceReferences,
      tbReferences: params.tbReferences,
    });

    if (params.debug) {
      params.debug.model = params.model;
      params.debug.systemPrompt = promptBundle.systemPrompt;
      params.debug.userPrompt = promptBundle.userPrompt;
    }

    logAIPromptDebug({
      flow: params.promptDebugFlow ?? 'test',
      model: params.model,
      reasoningEffort: params.reasoningEffort ?? 'medium',
      systemPrompt: promptBundle.systemPrompt,
      userPrompt: promptBundle.userPrompt,
      attempt: params.promptDebugAttempt,
      segmentId: params.promptDebugSegmentId,
    });

    const response = await this.transport.createResponse({
      apiKey: params.apiKey,
      baseUrl: params.baseUrl,
      model: params.model,
      reasoningEffort: params.reasoningEffort ?? 'medium',
      systemPrompt: promptBundle.systemPrompt,
      userPrompt: promptBundle.userPrompt,
    });

    if (params.debug) {
      params.debug.requestId = response.requestId;
      params.debug.status = response.status;
      params.debug.endpoint = response.endpoint;
      params.debug.rawResponseText = response.rawResponseText;
      params.debug.responseContent = response.content;
    }

    const trimmed = response.content.trim();
    if (!trimmed) {
      throw new Error('AI provider response was empty');
    }

    return trimmed;
  }
}
