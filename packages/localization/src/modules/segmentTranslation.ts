import type { Segment, Token } from '@cat/core/models';
import type { Project } from '@cat/core/project';
import { serializeTokensToEditorText, type TagPolicy } from '@cat/core/tag';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { AIRuntimeConfigProvider } from '../ports';
import type { AIProviderCatalogService } from '../providers/AIProviderCatalogService';
import { AITextTranslator, type TranslateDebugMeta } from './AITextTranslator';
import type { TranslationPromptReferences } from './promptReferences';

export interface SegmentTranslationDependencies {
  providerCatalogService: Pick<AIProviderCatalogService, 'resolveProviderConfig'>;
  aiRuntimeConfigProvider: AIRuntimeConfigProvider;
  textTranslator: AITextTranslator;
  resolveTranslationPromptReferences: (
    projectId: number,
    segment: Segment,
  ) => Promise<TranslationPromptReferences>;
}

export async function translateProjectSegment(
  project: Project,
  segment: Segment,
  tagPolicy: TagPolicy,
  deps: SegmentTranslationDependencies,
  providerId?: string,
  instruction?: string,
): Promise<Token[]> {
  const { provider, apiKey } = deps.providerCatalogService.resolveProviderConfig(
    providerId ?? project.aiModel,
  );

  const refinementInstruction = instruction?.trim();
  if (instruction !== undefined && !refinementInstruction) {
    throw new Error('Refinement instruction is empty');
  }

  const sourceText = serializeTokensToDisplayText(segment.sourceTokens);
  if (!sourceText.trim()) {
    throw new Error('Source segment is empty');
  }

  const currentTranslationText = serializeTokensToDisplayText(segment.targetTokens);
  if (instruction !== undefined && !currentTranslationText.trim()) {
    throw new Error('Target segment is empty');
  }

  const sourceTagPreservedText = buildPolicyPayload(
    segment.sourceTokens,
    segment.sourceTokens,
    tagPolicy,
  );
  const currentTranslationTagPreservedText = buildPolicyPayload(
    segment.targetTokens,
    segment.sourceTokens,
    tagPolicy,
  );
  const context = segment.meta?.context ? String(segment.meta.context).trim() : '';
  const projectType = project.projectType || 'translation';
  const runtimeConfig = await deps.aiRuntimeConfigProvider.getModelConfig(provider.model);
  const promptReferences =
    projectType === 'translation'
      ? await deps.resolveTranslationPromptReferences(project.id, segment)
      : {};

  return await deps.textTranslator.translateSegment({
    segmentId: segment.segmentId,
    apiKey,
    baseUrl: provider.baseUrl,
    model: provider.model,
    projectPrompt: project.aiPrompt || '',
    projectType,
    reasoningEffort: runtimeConfig.reasoningEffort,
    srcLang: project.srcLang,
    tgtLang: project.tgtLang,
    tagPolicy,
    sourceTokens: segment.sourceTokens,
    sourceText,
    sourceTagPreservedText,
    context,
    currentTranslationPayload:
      instruction === undefined ? undefined : currentTranslationTagPreservedText,
    refinementInstruction,
    tmReference: promptReferences.tmReference,
    tmReferences: promptReferences.tmReferences,
    concordanceReferences: promptReferences.concordanceReferences,
    tbReferences: promptReferences.tbReferences,
  });
}

export async function testProjectText(
  project: Project | undefined,
  sourceText: string,
  contextText: string | undefined,
  deps: Pick<
    SegmentTranslationDependencies,
    'providerCatalogService' | 'aiRuntimeConfigProvider' | 'textTranslator'
  >,
): Promise<{
  ok: boolean;
  error?: string;
  systemPrompt: string;
  userPrompt: string;
  translatedText: string;
  requestId?: string;
  status?: number;
  endpoint?: string;
  model?: string;
  rawResponseText?: string;
  responseContent?: string;
}> {
  if (!project) {
    return {
      ok: false,
      error: 'Project not found',
      systemPrompt: '',
      userPrompt: '',
      translatedText: '',
    };
  }

  const source = sourceText.trim();
  const context = contextText?.trim() ?? '';
  const debug: TranslateDebugMeta = {};

  try {
    const { provider, apiKey } = deps.providerCatalogService.resolveProviderConfig(project.aiModel);
    const runtimeConfig = await deps.aiRuntimeConfigProvider.getModelConfig(provider.model);
    const translatedText = await deps.textTranslator.translateText({
      apiKey,
      baseUrl: provider.baseUrl,
      model: provider.model,
      projectPrompt: project.aiPrompt || '',
      projectType: project.projectType || 'translation',
      reasoningEffort: runtimeConfig.reasoningEffort,
      srcLang: project.srcLang,
      tgtLang: project.tgtLang,
      sourceText: source,
      context,
      debug,
      promptDebugFlow: 'test',
    });

    return {
      ok: true,
      systemPrompt: debug.systemPrompt ?? '',
      userPrompt: debug.userPrompt ?? '',
      translatedText,
      requestId: debug.requestId,
      status: debug.status,
      endpoint: debug.endpoint,
      model: debug.model,
      rawResponseText: debug.rawResponseText,
      responseContent: debug.responseContent,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      systemPrompt: debug.systemPrompt ?? '',
      userPrompt: debug.userPrompt ?? '',
      translatedText: '',
      requestId: debug.requestId,
      status: debug.status,
      endpoint: debug.endpoint,
      model: debug.model,
      rawResponseText: debug.rawResponseText,
      responseContent: debug.responseContent,
    };
  }
}

function buildPolicyPayload(tokens: Token[], sourceTokens: Token[], tagPolicy: TagPolicy): string {
  return tagPolicy === 'none'
    ? serializeTokensToDisplayText(tokens)
    : serializeTokensToEditorText(tokens, sourceTokens);
}
