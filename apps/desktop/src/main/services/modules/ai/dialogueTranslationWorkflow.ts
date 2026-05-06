import type { Project } from '@cat/core/project';
import { TagValidator } from '@cat/core/qa';
import { serializeTokensToEditorText } from '@cat/core/tag';
import type { AIBatchTargetScope } from '../../../../shared/ipc';
import type { AiModelRuntimeConfig, AITransport } from '../../ports';
import { SegmentService } from '../../SegmentService';
import { getAIProgressVerb } from './aiProgressVerb';
import { buildDialogueUnits, translateDialogueUnit } from './dialogueTranslation';
import { SegmentPagingIterator } from './SegmentPagingIterator';
import type { TranslationPromptReferences } from './types';
import { isTranslatableSegment } from './translationTargetScope';
import { AITextTranslator } from './AITextTranslator';
import { translateBatchSegment } from './fileTranslationWorkflow';
import { logAIBatchDebug } from './aiBatchDebug';

const DIALOGUE_MAX_SEGMENTS_PER_UNIT = 6;
const DIALOGUE_MAX_CHARS_PER_UNIT = 1200;

export interface DialogueFileTranslationParams {
  fileId: number;
  project: Project;
  apiKey: string;
  baseUrl: string;
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

  logAIBatchDebug({
    event: 'dialogue_file_start',
    mode: 'dialogue',
    fileId: params.fileId,
    projectId: params.project.id,
    projectType: params.project.projectType || 'translation',
    targetScope: params.targetScope,
    totalSegments,
    translatableSegments: total,
    skipped,
    unitCount: units.length,
    model: params.model,
    reasoningEffort: params.runtimeConfig.reasoningEffort,
  });

  for (const unit of units) {
    logAIBatchDialogueUnitEvent('dialogue_unit_start', params, unit);
    try {
      const result = await translateDialogueUnit({
        projectId: params.project.id,
        project: params.project,
        apiKey: params.apiKey,
        baseUrl: params.baseUrl,
        model: params.model,
        runtimeConfig: params.runtimeConfig,
        unit,
        previousGroup,
        transport: params.transport,
        tagValidator: params.tagValidator,
        resolveTranslationPromptReferences: (projectId, segment) =>
          params.resolveTranslationPromptReferences(projectId, segment),
      });

      logAIBatchDialogueUnitEvent('dialogue_unit_translated', params, unit, {
        updateCount: result.updates.length,
      });
      await params.segmentService.updateSegmentsAtomically(result.updates);
      logAIBatchDialogueUnitEvent('dialogue_unit_write_success', params, unit, {
        updateCount: result.updates.length,
      });
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
      logAIBatchDialogueUnitEvent('dialogue_unit_failed_fallback', params, unit, {
        stage: 'translate_or_write',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
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
        let stage: 'translate' | 'write' = 'translate';
        logAIBatchDialogueSegmentEvent('dialogue_fallback_segment_start', params, draft.segment);
        try {
          const targetTokens = await translateBatchSegment(
            {
              projectId: params.project.id,
              segment: draft.segment,
              apiKey: params.apiKey,
              baseUrl: params.baseUrl,
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

          stage = 'write';
          logAIBatchDialogueSegmentEvent(
            'dialogue_fallback_segment_translated',
            params,
            draft.segment,
            {
              targetChars: serializeTokensToEditorText(
                targetTokens,
                draft.segment.sourceTokens,
              ).trim().length,
              targetPreview: buildPreview(
                serializeTokensToEditorText(targetTokens, draft.segment.sourceTokens),
              ),
              tokenCount: targetTokens.length,
            },
          );
          await params.segmentService.updateSegment(
            draft.segment.segmentId,
            targetTokens,
            'translated',
          );
          logAIBatchDialogueSegmentEvent(
            'dialogue_fallback_segment_write_success',
            params,
            draft.segment,
            {
              targetChars: serializeTokensToEditorText(
                targetTokens,
                draft.segment.sourceTokens,
              ).trim().length,
            },
          );
          translated += 1;
          previousGroup = {
            speaker: draft.speaker || 'Unknown',
            sourceText: draft.sourcePayload,
            targetText: serializeTokensToEditorText(targetTokens, draft.segment.sourceTokens),
          };
        } catch (fallbackError) {
          failed += 1;
          logAIBatchDialogueSegmentEvent(
            'dialogue_fallback_segment_failed',
            params,
            draft.segment,
            {
              stage,
              error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
              stack: fallbackError instanceof Error ? fallbackError.stack : undefined,
            },
          );
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

  logAIBatchDebug({
    event: 'dialogue_file_complete',
    mode: 'dialogue',
    fileId: params.fileId,
    projectId: params.project.id,
    translated,
    skipped,
    failed,
    total: totalSegments,
  });

  return { translated, skipped, failed, total: totalSegments };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPreview(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 160);
}

function logAIBatchDialogueUnitEvent(
  event: string,
  params: DialogueFileTranslationParams,
  unit: ReturnType<typeof buildDialogueUnits>[number],
  details: Record<string, unknown> = {},
): void {
  logAIBatchDebug({
    event,
    mode: 'dialogue',
    fileId: params.fileId,
    projectId: params.project.id,
    segmentIds: unit.segments.map((draft) => draft.segment.segmentId),
    orderIndexes: unit.segments.map((draft) => draft.segment.orderIndex),
    speaker: unit.speaker || 'Unknown',
    groupSize: unit.segments.length,
    sourceChars: unit.charCount,
    sourcePreview: buildPreview(unit.segments.map((draft) => draft.sourcePayload).join('\n')),
    ...details,
  });
}

function logAIBatchDialogueSegmentEvent(
  event: string,
  params: DialogueFileTranslationParams,
  segment: Parameters<typeof translateBatchSegment>[0]['segment'],
  details: Record<string, unknown> = {},
): void {
  const sourceText = serializeTokensToEditorText(segment.sourceTokens, segment.sourceTokens);
  const existingTargetText = serializeTokensToEditorText(
    segment.targetTokens,
    segment.sourceTokens,
  );
  logAIBatchDebug({
    event,
    mode: 'dialogue',
    fileId: params.fileId,
    projectId: params.project.id,
    segmentId: segment.segmentId,
    orderIndex: segment.orderIndex,
    status: segment.status,
    sourceChars: sourceText.trim().length,
    sourcePreview: buildPreview(sourceText),
    existingTargetChars: existingTargetText.trim().length,
    existingTargetPreview: buildPreview(existingTargetText),
    ...details,
  });
}
