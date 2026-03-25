import { type Segment, type SegmentStatus, type Token } from '@cat/core/models';
import type { Project, ProjectType } from '@cat/core/project';
import { serializeTokensToEditorText } from '@cat/core/tag';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { AIBatchTargetScope } from '../../../../shared/ipc';
import { SegmentService } from '../../SegmentService';
import { getAIProgressVerb } from '../ai-prompts';
import type { TranslationPromptReferences } from './types';
import { SegmentPagingIterator } from './SegmentPagingIterator';
import { AITextTranslator } from './AITextTranslator';
import { isTranslatableSegment } from './translationTargetScope';

export interface TranslateBatchSegmentParams {
  projectId: number;
  segment: Segment;
  apiKey: string;
  model: string;
  projectPrompt: string;
  projectType: ProjectType;
  temperature: number;
  srcLang: string;
  tgtLang: string;
}

export interface StandardFileTranslationParams {
  fileId: number;
  projectId: number;
  project: Project;
  apiKey: string;
  model: string;
  temperature: number;
  targetScope: AIBatchTargetScope;
  segmentPagingIterator: SegmentPagingIterator;
  textTranslator: AITextTranslator;
  segmentService: SegmentService;
  resolveTranslationPromptReferences: (
    projectId: number,
    segment: Segment,
  ) => Promise<TranslationPromptReferences>;
  onProgress?: (data: { current: number; total: number; message?: string }) => void;
  intervalMs?: number;
}

export async function translateBatchSegment(
  params: TranslateBatchSegmentParams,
  deps: {
    textTranslator: AITextTranslator;
    resolveTranslationPromptReferences: (
      projectId: number,
      segment: Segment,
    ) => Promise<TranslationPromptReferences>;
  },
): Promise<Token[]> {
  const sourceText = serializeTokensToDisplayText(params.segment.sourceTokens);
  const sourceTagPreservedText = serializeTokensToEditorText(
    params.segment.sourceTokens,
    params.segment.sourceTokens,
  );
  const context = params.segment.meta?.context ? String(params.segment.meta.context).trim() : '';
  const promptReferences =
    params.projectType === 'translation'
      ? await deps.resolveTranslationPromptReferences(params.projectId, params.segment)
      : {};

  return deps.textTranslator.translateSegment({
    apiKey: params.apiKey,
    model: params.model,
    projectPrompt: params.projectPrompt,
    projectType: params.projectType,
    temperature: params.temperature,
    srcLang: params.srcLang,
    tgtLang: params.tgtLang,
    sourceTokens: params.segment.sourceTokens,
    sourceText,
    sourceTagPreservedText,
    context,
    tmReference: promptReferences.tmReference,
    tbReferences: promptReferences.tbReferences,
  });
}

export async function runStandardFileTranslation(
  params: StandardFileTranslationParams,
): Promise<{ translated: number; skipped: number; failed: number; total: number }> {
  const totalSegments = params.segmentPagingIterator.countFileSegments(params.fileId);
  const total = params.segmentPagingIterator.countMatchingSegments(params.fileId, (segment) =>
    isTranslatableSegment(segment, params.targetScope),
  );
  let current = 0;
  let translated = 0;
  const skipped = totalSegments - total;
  let failed = 0;
  const aiStatus: SegmentStatus =
    (params.project.projectType || 'translation') === 'review' ? 'reviewed' : 'translated';

  for (const segment of params.segmentPagingIterator.iterateFileSegments(params.fileId)) {
    if (!isTranslatableSegment(segment, params.targetScope)) continue;

    current += 1;
    params.onProgress?.({
      current,
      total,
      message: `${getAIProgressVerb(params.project.projectType || 'translation')} segment ${current} of ${total}`,
    });

    try {
      const targetTokens = await translateBatchSegment(
        {
          projectId: params.projectId,
          segment,
          apiKey: params.apiKey,
          model: params.model,
          projectPrompt: params.project.aiPrompt || '',
          projectType: params.project.projectType || 'translation',
          temperature: params.temperature,
          srcLang: params.project.srcLang,
          tgtLang: params.project.tgtLang,
        },
        {
          textTranslator: params.textTranslator,
          resolveTranslationPromptReferences: params.resolveTranslationPromptReferences,
        },
      );

      await params.segmentService.updateSegment(segment.segmentId, targetTokens, aiStatus);
      translated += 1;
    } catch (error) {
      failed += 1;
      console.warn('[AITranslationOrchestrator] Failed to translate segment in file workflow', {
        fileId: params.fileId,
        segmentId: segment.segmentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if ((params.intervalMs ?? 40) > 0) {
      await sleep(params.intervalMs ?? 40);
    }
  }

  return { translated, skipped, failed, total: totalSegments };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
