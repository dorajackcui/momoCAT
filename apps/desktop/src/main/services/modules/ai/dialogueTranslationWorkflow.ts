import type { Project } from '@cat/core/project';
import { TagValidator } from '@cat/core/qa';
import { serializeTokensToEditorText } from '@cat/core/tag';
import type { AIBatchTargetScope } from '../../../../shared/ipc';
import type { AiModelRuntimeConfig, AITransport } from '../../ports';
import { SegmentService } from '../../SegmentService';
import { getAIProgressVerb } from '../ai-prompts';
import { buildDialogueUnits, translateDialogueUnit } from './dialogueTranslation';
import { SegmentPagingIterator } from './SegmentPagingIterator';
import type { TranslationPromptReferences } from './types';
import { isTranslatableSegment } from './translationTargetScope';
import { AITextTranslator } from './AITextTranslator';
import { translateBatchSegment } from './fileTranslationWorkflow';

const DIALOGUE_MAX_SEGMENTS_PER_UNIT = 6;
const DIALOGUE_MAX_CHARS_PER_UNIT = 1200;

export interface DialogueFileTranslationParams {
  fileId: number;
  project: Project;
  apiKey: string;
  model: string;
  runtimeConfig: AiModelRuntimeConfig;
  targetScope: AIBatchTargetScope;
  transport: AITransport;
  tagValidator: TagValidator;
  textTranslator: AITextTranslator;
  segmentService: SegmentService;
  segmentPagingIterator: SegmentPagingIterator;
  resolveTranslationPromptReferences: (
    projectId: number,
    segment: Parameters<
      NonNullable<Parameters<typeof translateDialogueUnit>[0]['resolveTranslationPromptReferences']>
    >[1],
  ) => Promise<TranslationPromptReferences>;
  onProgress?: (data: { current: number; total: number; message?: string }) => void;
  intervalMs?: number;
}

export async function runDialogueFileTranslation(
  params: DialogueFileTranslationParams,
): Promise<{ translated: number; skipped: number; failed: number; total: number }> {
  const units = buildDialogueUnits({
    segments: params.segmentPagingIterator.iterateFileSegments(params.fileId),
    isTranslatableSegment: (segment) => isTranslatableSegment(segment, params.targetScope),
    maxSegmentsPerUnit: DIALOGUE_MAX_SEGMENTS_PER_UNIT,
    maxCharsPerUnit: DIALOGUE_MAX_CHARS_PER_UNIT,
  });
  const totalSegments = params.segmentPagingIterator.countFileSegments(params.fileId);
  const total = units.reduce((sum, unit) => sum + unit.segments.length, 0);
  const skipped = totalSegments - total;
  let current = 0;
  let translated = 0;
  let failed = 0;
  let previousGroup: { speaker: string; sourceText: string; targetText: string } | undefined;

  for (const unit of units) {
    try {
      const result = await translateDialogueUnit({
        projectId: params.project.id,
        project: params.project,
        apiKey: params.apiKey,
        model: params.model,
        runtimeConfig: params.runtimeConfig,
        unit,
        previousGroup,
        transport: params.transport,
        tagValidator: params.tagValidator,
        resolveTranslationPromptReferences: (projectId, segment) =>
          params.resolveTranslationPromptReferences(projectId, segment),
      });

      await params.segmentService.updateSegmentsAtomically(result.updates);
      translated += unit.segments.length;
      previousGroup = result.previousGroup;
      for (let index = 0; index < unit.segments.length; index += 1) {
        current += 1;
        params.onProgress?.({
          current,
          total,
          message: `${getAIProgressVerb('translation')} segment ${current} of ${total}`,
        });
      }
    } catch (error) {
      console.warn(
        '[AITranslationOrchestrator] Dialogue group translation failed; falling back to per-segment mode',
        {
          fileId: params.fileId,
          projectId: params.project.id,
          groupSize: unit.segments.length,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      for (const draft of unit.segments) {
        try {
          const targetTokens = await translateBatchSegment(
            {
              projectId: params.project.id,
              segment: draft.segment,
              apiKey: params.apiKey,
              model: params.model,
              projectPrompt: params.project.aiPrompt || '',
              projectType: 'translation',
              runtimeConfig: params.runtimeConfig,
              srcLang: params.project.srcLang,
              tgtLang: params.project.tgtLang,
            },
            {
              textTranslator: params.textTranslator,
              resolveTranslationPromptReferences: params.resolveTranslationPromptReferences,
            },
          );

          await params.segmentService.updateSegment(
            draft.segment.segmentId,
            targetTokens,
            'translated',
          );
          translated += 1;
          previousGroup = {
            speaker: draft.speaker || 'Unknown',
            sourceText: draft.sourcePayload,
            targetText: serializeTokensToEditorText(targetTokens, draft.segment.sourceTokens),
          };
        } catch (fallbackError) {
          failed += 1;
          console.warn('[AITranslationOrchestrator] Dialogue fallback segment translation failed', {
            fileId: params.fileId,
            segmentId: draft.segment.segmentId,
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
        }
        current += 1;
        params.onProgress?.({
          current,
          total,
          message: `${getAIProgressVerb('translation')} segment ${current} of ${total}`,
        });

        if ((params.intervalMs ?? 40) > 0) {
          await sleep(params.intervalMs ?? 40);
        }
      }

      continue;
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
