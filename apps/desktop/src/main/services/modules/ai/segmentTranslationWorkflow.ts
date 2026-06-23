import { type Segment, type SegmentStatus, type Token } from '@cat/core/models';
import { serializeTokensToEditorText, type TagPolicy } from '@cat/core/tag';
import { serializeTokensToDisplayText } from '@cat/core/text';
import { resolveFileTagPolicy } from '../../../../shared/fileTagPolicy';
import type { AIRuntimeConfigProvider, ProjectRepository, SegmentRepository } from '../../ports';
import { SegmentService } from '../../SegmentService';
import { AIProviderCatalogService } from './AIProviderCatalogService';
import { AITextTranslator, TranslateDebugMeta } from './AITextTranslator';
import type { TranslationPromptReferences } from './types';

interface SegmentWorkflowDeps {
  projectRepo: ProjectRepository;
  segmentRepo: SegmentRepository;
  segmentService: SegmentService;
  providerCatalogService: AIProviderCatalogService;
  aiRuntimeConfigProvider: AIRuntimeConfigProvider;
  textTranslator: AITextTranslator;
  resolveTranslationPromptReferences: (
    projectId: number,
    segment: Segment,
  ) => Promise<TranslationPromptReferences>;
}

interface SegmentWorkflowOptions {
  model?: string;
}

interface WithSegmentLock {
  <T>(segmentId: string, task: () => Promise<T>): Promise<T>;
}

export async function runSegmentTranslation(
  segmentId: string,
  options: SegmentWorkflowOptions | undefined,
  deps: SegmentWorkflowDeps,
  withSegmentLock: WithSegmentLock,
): Promise<{ segmentId: string; status: SegmentStatus }> {
  return withSegmentLock(segmentId, async () => {
    const segment = deps.segmentRepo.getSegment(segmentId);
    if (!segment) throw new Error('Segment not found');

    const file = deps.projectRepo.getFile(segment.fileId);
    if (!file) throw new Error('File not found');

    const project = deps.projectRepo.getProject(file.projectId);
    if (!project) throw new Error('Project not found');

    const { provider, apiKey } = deps.providerCatalogService.resolveProviderConfig(
      options?.model ?? project.aiModel,
    );

    const sourceText = serializeTokensToDisplayText(segment.sourceTokens);
    if (!sourceText.trim()) {
      throw new Error('Source segment is empty');
    }

    const tagPolicy = resolveFileTagPolicy(file);
    const sourceTagPreservedText = buildPolicyPayload(
      segment.sourceTokens,
      segment.sourceTokens,
      tagPolicy,
    );
    const context = segment.meta?.context ? String(segment.meta.context).trim() : '';
    const projectType = project.projectType || 'translation';
    const aiStatus: SegmentStatus = projectType === 'review' ? 'reviewed' : 'translated';
    const runtimeConfig = await deps.aiRuntimeConfigProvider.getModelConfig(provider.model);
    const promptReferences =
      projectType === 'translation'
        ? await deps.resolveTranslationPromptReferences(file.projectId, segment)
        : {};

    const targetTokens = await deps.textTranslator.translateSegment({
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
      tmReference: promptReferences.tmReference,
      tmReferences: promptReferences.tmReferences,
      concordanceReferences: promptReferences.concordanceReferences,
      tbReferences: promptReferences.tbReferences,
    });

    const updateResult = await deps.segmentService.updateSegment(
      segment.segmentId,
      targetTokens,
      aiStatus,
    );

    return {
      segmentId: segment.segmentId,
      targetTokens,
      status: aiStatus,
      propagatedIds: updateResult?.propagatedIds ?? [],
      serverAppliedAt: updateResult?.serverAppliedAt ?? new Date().toISOString(),
    };
  });
}

export async function runSegmentRefinement(
  segmentId: string,
  instruction: string,
  options: SegmentWorkflowOptions | undefined,
  deps: SegmentWorkflowDeps,
  withSegmentLock: WithSegmentLock,
): Promise<{ segmentId: string; status: SegmentStatus }> {
  return withSegmentLock(segmentId, async () => {
    const segment = deps.segmentRepo.getSegment(segmentId);
    if (!segment) throw new Error('Segment not found');

    const file = deps.projectRepo.getFile(segment.fileId);
    if (!file) throw new Error('File not found');

    const project = deps.projectRepo.getProject(file.projectId);
    if (!project) throw new Error('Project not found');

    const { provider, apiKey } = deps.providerCatalogService.resolveProviderConfig(
      options?.model ?? project.aiModel,
    );

    const refinementInstruction = instruction.trim();
    if (!refinementInstruction) {
      throw new Error('Refinement instruction is empty');
    }

    const sourceText = serializeTokensToDisplayText(segment.sourceTokens);
    if (!sourceText.trim()) {
      throw new Error('Source segment is empty');
    }

    const currentTranslationText = serializeTokensToDisplayText(segment.targetTokens);
    if (!currentTranslationText.trim()) {
      throw new Error('Target segment is empty');
    }

    const tagPolicy = resolveFileTagPolicy(file);
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
    const aiStatus: SegmentStatus = projectType === 'review' ? 'reviewed' : 'translated';
    const runtimeConfig = await deps.aiRuntimeConfigProvider.getModelConfig(provider.model);
    const promptReferences =
      projectType === 'translation'
        ? await deps.resolveTranslationPromptReferences(file.projectId, segment)
        : {};

    const targetTokens = await deps.textTranslator.translateSegment({
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
      currentTranslationPayload: currentTranslationTagPreservedText,
      refinementInstruction,
      tmReference: promptReferences.tmReference,
      tmReferences: promptReferences.tmReferences,
      concordanceReferences: promptReferences.concordanceReferences,
      tbReferences: promptReferences.tbReferences,
    });

    const updateResult = await deps.segmentService.updateSegment(
      segment.segmentId,
      targetTokens,
      aiStatus,
    );

    return {
      segmentId: segment.segmentId,
      targetTokens,
      status: aiStatus,
      propagatedIds: updateResult?.propagatedIds ?? [],
      serverAppliedAt: updateResult?.serverAppliedAt ?? new Date().toISOString(),
    };
  });
}

export async function runTestTranslation(
  projectId: number,
  sourceText: string,
  contextText: string | undefined,
  deps: Pick<
    SegmentWorkflowDeps,
    'projectRepo' | 'providerCatalogService' | 'aiRuntimeConfigProvider' | 'textTranslator'
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
  const project = deps.projectRepo.getProject(projectId);
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
      allowUnchanged: true,
      promptDebugFlow: 'test',
    });

    const unchanged =
      translatedText.trim() === source &&
      project.srcLang !== project.tgtLang &&
      project.projectType !== 'review' &&
      project.projectType !== 'custom';

    return {
      ok: !unchanged,
      error: unchanged ? `Model returned source unchanged: ${translatedText}` : undefined,
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

export function buildSegmentWorkflowDeps(params: {
  projectRepo: ProjectRepository;
  segmentRepo: SegmentRepository;
  segmentService: SegmentService;
  providerCatalogService: AIProviderCatalogService;
  aiRuntimeConfigProvider: AIRuntimeConfigProvider;
  textTranslator: AITextTranslator;
  resolveTranslationPromptReferences: (
    projectId: number,
    segment: Segment,
  ) => Promise<TranslationPromptReferences>;
}): SegmentWorkflowDeps {
  return {
    projectRepo: params.projectRepo,
    segmentRepo: params.segmentRepo,
    segmentService: params.segmentService,
    providerCatalogService: params.providerCatalogService,
    aiRuntimeConfigProvider: params.aiRuntimeConfigProvider,
    textTranslator: params.textTranslator,
    resolveTranslationPromptReferences: params.resolveTranslationPromptReferences,
  };
}

function buildPolicyPayload(tokens: Token[], sourceTokens: Token[], tagPolicy: TagPolicy): string {
  return tagPolicy === 'none'
    ? serializeTokensToDisplayText(tokens)
    : serializeTokensToEditorText(tokens, sourceTokens);
}

export function createSegmentOperationLock(): {
  withSegmentLock: WithSegmentLock;
} {
  const locks = new Set<string>();

  return {
    withSegmentLock: async <T>(segmentId: string, task: () => Promise<T>): Promise<T> => {
      if (locks.has(segmentId)) {
        throw new Error('AI request already in progress for this segment');
      }
      locks.add(segmentId);
      try {
        return await task();
      } finally {
        locks.delete(segmentId);
      }
    },
  };
}
