import { type Segment, type SegmentStatus } from '@cat/core/models';
import { serializeTokensToEditorText } from '@cat/core/tag';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { ProjectRepository, SegmentRepository } from '../../ports';
import { SegmentService } from '../../SegmentService';
import { buildAIUserPrompt, buildAISystemPrompt, normalizeProjectType } from '../ai-prompts';
import { AISettingsService } from './AISettingsService';
import { AITextTranslator, TranslateDebugMeta } from './AITextTranslator';
import type { TranslationPromptReferences } from './types';

interface SegmentWorkflowDeps {
  projectRepo: ProjectRepository;
  segmentRepo: SegmentRepository;
  segmentService: SegmentService;
  settingsService: AISettingsService;
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

    const apiKey = deps.settingsService.getStoredApiKey();
    if (!apiKey) {
      throw new Error('AI API key is not configured');
    }

    const sourceText = serializeTokensToDisplayText(segment.sourceTokens);
    if (!sourceText.trim()) {
      throw new Error('Source segment is empty');
    }

    const sourceTagPreservedText = serializeTokensToEditorText(
      segment.sourceTokens,
      segment.sourceTokens,
    );
    const context = segment.meta?.context ? String(segment.meta.context).trim() : '';
    const projectType = project.projectType || 'translation';
    const aiStatus: SegmentStatus = projectType === 'review' ? 'reviewed' : 'translated';
    const model = deps.textTranslator.resolveModel(options?.model, project.aiModel);
    const temperature = deps.textTranslator.resolveTemperature(project.aiTemperature);
    const promptReferences =
      projectType === 'translation'
        ? await deps.resolveTranslationPromptReferences(file.projectId, segment)
        : {};

    const targetTokens = await deps.textTranslator.translateSegment({
      apiKey,
      model,
      projectPrompt: project.aiPrompt || '',
      projectType,
      temperature,
      srcLang: project.srcLang,
      tgtLang: project.tgtLang,
      sourceTokens: segment.sourceTokens,
      sourceText,
      sourceTagPreservedText,
      context,
      tmReference: promptReferences.tmReference,
      tbReferences: promptReferences.tbReferences,
    });

    await deps.segmentService.updateSegment(segment.segmentId, targetTokens, aiStatus);

    return { segmentId: segment.segmentId, status: aiStatus };
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

    const apiKey = deps.settingsService.getStoredApiKey();
    if (!apiKey) {
      throw new Error('AI API key is not configured');
    }

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

    const sourceTagPreservedText = serializeTokensToEditorText(
      segment.sourceTokens,
      segment.sourceTokens,
    );
    const currentTranslationTagPreservedText = serializeTokensToEditorText(
      segment.targetTokens,
      segment.sourceTokens,
    );
    const context = segment.meta?.context ? String(segment.meta.context).trim() : '';
    const projectType = project.projectType || 'translation';
    const aiStatus: SegmentStatus = projectType === 'review' ? 'reviewed' : 'translated';
    const model = deps.textTranslator.resolveModel(options?.model, project.aiModel);
    const temperature = deps.textTranslator.resolveTemperature(project.aiTemperature);
    const promptReferences =
      projectType === 'translation'
        ? await deps.resolveTranslationPromptReferences(file.projectId, segment)
        : {};

    const targetTokens = await deps.textTranslator.translateSegment({
      apiKey,
      model,
      projectPrompt: project.aiPrompt || '',
      projectType,
      temperature,
      srcLang: project.srcLang,
      tgtLang: project.tgtLang,
      sourceTokens: segment.sourceTokens,
      sourceText,
      sourceTagPreservedText,
      context,
      currentTranslationPayload: currentTranslationTagPreservedText,
      refinementInstruction,
      tmReference: promptReferences.tmReference,
      tbReferences: promptReferences.tbReferences,
    });

    await deps.segmentService.updateSegment(segment.segmentId, targetTokens, aiStatus);

    return { segmentId: segment.segmentId, status: aiStatus };
  });
}

export async function runTestTranslation(
  projectId: number,
  sourceText: string,
  contextText: string | undefined,
  deps: Pick<SegmentWorkflowDeps, 'projectRepo' | 'settingsService' | 'textTranslator'>,
): Promise<{
  ok: boolean;
  error?: string;
  promptUsed: string;
  userMessage: string;
  translatedText: string;
  requestId?: string;
  status?: number;
  endpoint?: string;
  model?: string;
  rawResponseText?: string;
  responseContent?: string;
}> {
  const project = deps.projectRepo.getProject(projectId);
  if (!project) throw new Error('Project not found');

  const apiKey = deps.settingsService.getStoredApiKey();
  if (!apiKey) {
    throw new Error('AI API key is not configured');
  }

  const model = deps.textTranslator.resolveModel(project.aiModel);
  const temperature = deps.textTranslator.resolveTemperature(project.aiTemperature);
  const source = sourceText.trim();
  const context = contextText?.trim() ?? '';
  const promptUsed = buildAISystemPrompt(project.projectType || 'translation', {
    srcLang: project.srcLang,
    tgtLang: project.tgtLang,
    projectPrompt: project.aiPrompt || '',
  });
  const userMessage = buildAIUserPrompt(normalizeProjectType(project.projectType), {
    srcLang: project.srcLang,
    sourcePayload: source,
    hasProtectedMarkers: false,
    context,
  });
  const debug: TranslateDebugMeta = {};

  try {
    const translatedText = await deps.textTranslator.translateText({
      apiKey,
      model,
      projectPrompt: project.aiPrompt || '',
      projectType: project.projectType || 'translation',
      temperature,
      srcLang: project.srcLang,
      tgtLang: project.tgtLang,
      sourceText: source,
      context,
      debug,
      allowUnchanged: true,
    });

    const unchanged =
      translatedText.trim() === source &&
      project.srcLang !== project.tgtLang &&
      project.projectType !== 'review' &&
      project.projectType !== 'custom';

    return {
      ok: !unchanged,
      error: unchanged ? `Model returned source unchanged: ${translatedText}` : undefined,
      promptUsed,
      userMessage,
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
      promptUsed,
      userMessage,
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
  settingsService: AISettingsService;
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
    settingsService: params.settingsService,
    textTranslator: params.textTranslator,
    resolveTranslationPromptReferences: params.resolveTranslationPromptReferences,
  };
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
