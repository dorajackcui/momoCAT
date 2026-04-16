import {
  buildAITextPromptBundle,
  normalizeProjectType,
  type ProjectType,
  type PromptTBReference,
  type PromptTMReference,
} from '@cat/core/project';
import type { Token } from '@cat/core/models';
import { TagValidator } from '@cat/core/qa';
import { parseEditorTextToTokens } from '@cat/core/tag';
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
  sourceTokens: Token[];
  sourceText: string;
  sourceTagPreservedText: string;
  context?: string;
  currentTranslationPayload?: string;
  refinementInstruction?: string;
  tmReference?: PromptTMReference;
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
  tbReferences?: PromptTBReference[];
  validationFeedback?: string;
  debug?: TranslateDebugMeta;
  allowUnchanged?: boolean;
  promptDebugFlow?: 'segment' | 'refine' | 'test';
  promptDebugAttempt?: number;
  promptDebugSegmentId?: string;
}

export class AITextTranslator {
  constructor(
    private readonly transport: AITransport,
    private readonly tagValidator: TagValidator,
  ) {}

  public async translateSegment(params: TranslateSegmentParams): Promise<Token[]> {
    const maxAttempts = 3;
    let validationFeedback: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
        tbReferences: params.tbReferences,
        validationFeedback,
        allowUnchanged: normalizedType === 'review' || normalizedType === 'custom',
        promptDebugFlow: params.refinementInstruction ? 'refine' : 'segment',
        promptDebugSegmentId: params.segmentId,
        promptDebugAttempt: attempt,
      });

      const targetTokens = parseEditorTextToTokens(translatedText, params.sourceTokens);
      if (normalizedType === 'custom') {
        return targetTokens;
      }
      const validationResult = this.tagValidator.validate(params.sourceTokens, targetTokens);
      const errors = validationResult.issues.filter((issue) => issue.severity === 'error');

      if (errors.length === 0) {
        return targetTokens;
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
      tbReferences: params.tbReferences,
      validationFeedback: params.validationFeedback,
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

    const unchangedAgainstSource = trimmed === params.sourceText.trim();
    const unchangedAgainstPayload = trimmed === promptBundle.sourcePayload.trim();
    const allowUnchanged =
      Boolean(params.allowUnchanged) || normalizedType === 'review' || normalizedType === 'custom';
    if (
      !allowUnchanged &&
      (unchangedAgainstSource || unchangedAgainstPayload) &&
      params.srcLang !== params.tgtLang
    ) {
      throw new Error(`Model returned source unchanged: ${trimmed}`);
    }

    return trimmed;
  }
}
