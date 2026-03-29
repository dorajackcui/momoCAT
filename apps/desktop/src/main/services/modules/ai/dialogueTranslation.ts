import { type Segment, type Token } from '@cat/core/models';
import type { Project } from '@cat/core/project';
import { TagValidator } from '@cat/core/qa';
import { parseEditorTextToTokens, serializeTokensToEditorText } from '@cat/core/tag';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { AiModelRuntimeConfig, AITransport } from '../../ports';
import { buildAIDialogueUserPrompt, buildAISystemPrompt } from '../ai-prompts';
import type { DialoguePromptPreviousGroup } from '../ai-prompts/types';
import type {
  DialogueSegmentDraft,
  DialogueTranslationResult,
  DialogueTranslationUnit,
  SegmentUpdateDraft,
  TranslationPromptReferences,
} from './types';

interface BuildDialogueUnitsParams {
  segments: Iterable<Segment>;
  isTranslatableSegment: (segment: Segment) => boolean;
  maxSegmentsPerUnit: number;
  maxCharsPerUnit: number;
}

interface TranslateDialogueUnitParams {
  projectId: number;
  project: Project;
  apiKey: string;
  model: string;
  runtimeConfig: AiModelRuntimeConfig;
  unit: DialogueTranslationUnit;
  previousGroup?: DialoguePromptPreviousGroup;
  transport: AITransport;
  tagValidator: TagValidator;
  resolveTranslationPromptReferences: (
    projectId: number,
    segment: Segment,
  ) => Promise<TranslationPromptReferences>;
}

export function buildDialogueUnits(params: BuildDialogueUnitsParams): DialogueTranslationUnit[] {
  const units: DialogueTranslationUnit[] = [];
  let currentUnit: DialogueTranslationUnit | undefined;

  const flushUnit = () => {
    if (currentUnit && currentUnit.segments.length > 0) {
      units.push(currentUnit);
    }
    currentUnit = undefined;
  };

  for (const segment of params.segments) {
    if (!params.isTranslatableSegment(segment)) {
      flushUnit();
      continue;
    }

    const sourceText = serializeTokensToDisplayText(segment.sourceTokens);
    const sourcePayload = serializeTokensToEditorText(segment.sourceTokens, segment.sourceTokens);
    const speaker = readDialogueSpeaker(segment);
    const speakerKey = speaker.toLocaleLowerCase();
    const draft: DialogueSegmentDraft = {
      segment,
      speaker,
      speakerKey,
      sourceText,
      sourcePayload,
    };

    if (!speaker) {
      flushUnit();
      units.push({
        speaker,
        speakerKey,
        charCount: sourcePayload.length,
        segments: [draft],
      });
      continue;
    }

    if (
      currentUnit &&
      currentUnit.speakerKey === speakerKey &&
      currentUnit.segments.length < params.maxSegmentsPerUnit &&
      currentUnit.charCount + sourcePayload.length <= params.maxCharsPerUnit
    ) {
      currentUnit.segments.push(draft);
      currentUnit.charCount += sourcePayload.length;
      continue;
    }

    flushUnit();
    currentUnit = {
      speaker,
      speakerKey,
      charCount: sourcePayload.length,
      segments: [draft],
    };
  }

  flushUnit();

  return units;
}

export async function translateDialogueUnit(
  params: TranslateDialogueUnitParams,
): Promise<DialogueTranslationResult> {
  const promptSegments = [];
  for (const draft of params.unit.segments) {
    const references = await params.resolveTranslationPromptReferences(
      params.projectId,
      draft.segment,
    );
    promptSegments.push({
      id: draft.segment.segmentId,
      speaker: draft.speaker || 'Unknown',
      sourcePayload: draft.sourcePayload,
      tmReference: references.tmReference,
      tbReferences: references.tbReferences,
    });
  }

  const systemPrompt = buildAISystemPrompt('translation', {
    srcLang: params.project.srcLang,
    tgtLang: params.project.tgtLang,
    projectPrompt: params.project.aiPrompt || '',
  });

  const expectedIds = params.unit.segments.map((segment) => segment.segment.segmentId);
  const maxAttempts = 3;
  let validationFeedback: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const userPrompt = buildAIDialogueUserPrompt({
      srcLang: params.project.srcLang,
      tgtLang: params.project.tgtLang,
      segments: promptSegments,
      previousGroup: params.previousGroup,
      validationFeedback,
    });

    const response = await params.transport.createResponse({
      apiKey: params.apiKey,
      model: params.model,
      reasoningEffort: params.runtimeConfig.reasoningEffort,
      systemPrompt,
      userPrompt,
    });
    const content = response.content.trim();
    if (!content) {
      throw new Error('OpenAI response was empty');
    }

    try {
      const translations = parseDialogueTranslations(content, expectedIds);
      const updates: SegmentUpdateDraft[] = [];
      const issues: string[] = [];

      for (const draft of params.unit.segments) {
        const translatedText = translations.get(draft.segment.segmentId) ?? '';
        if (
          isUnchangedOutput(
            translatedText,
            draft.sourceText,
            draft.sourcePayload,
            params.project.srcLang,
            params.project.tgtLang,
          )
        ) {
          issues.push(`Segment ${draft.segment.segmentId}: model returned source unchanged.`);
          continue;
        }

        let targetTokens: Token[];
        try {
          targetTokens = parseEditorTextToTokens(translatedText, draft.segment.sourceTokens);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          issues.push(`Segment ${draft.segment.segmentId}: token parsing failed (${message}).`);
          continue;
        }

        const validationResult = params.tagValidator.validate(
          draft.segment.sourceTokens,
          targetTokens,
        );
        const errors = validationResult.issues.filter((issue) => issue.severity === 'error');
        if (errors.length > 0) {
          issues.push(
            `Segment ${draft.segment.segmentId}: ${errors.map((errorItem) => errorItem.message).join('; ')}`,
          );
          continue;
        }

        updates.push({
          segmentId: draft.segment.segmentId,
          targetTokens,
          status: 'translated',
        });
      }

      if (issues.length === 0 && updates.length === params.unit.segments.length) {
        const targetText = params.unit.segments
          .map((draft) => translations.get(draft.segment.segmentId)?.trim() ?? '')
          .join('\n');
        return {
          updates,
          previousGroup: {
            speaker: params.unit.speaker || 'Unknown',
            sourceText: params.unit.segments.map((draft) => draft.sourcePayload).join('\n'),
            targetText,
          },
        };
      }

      if (attempt === maxAttempts) {
        throw new Error(
          `Dialogue translation failed after ${maxAttempts} attempts: ${issues.join(' ')}`,
        );
      }

      validationFeedback = [
        'Previous response was invalid.',
        ...issues.map((issue) => `- ${issue}`),
        'Retry with strict JSON format and keep protected markers unchanged.',
      ].join('\n');
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      validationFeedback = [
        'Previous response was invalid.',
        `- ${message}`,
        'Retry with strict JSON format and keep protected markers unchanged.',
      ].join('\n');
    }
  }

  throw new Error('Unexpected dialogue translation retry failure');
}

export function parseDialogueTranslations(raw: string, expectedIds: string[]): Map<string, string> {
  const payload = extractJsonPayload(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error('Response is not valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Response must be a JSON object.');
  }
  const translations = (parsed as { translations?: unknown }).translations;
  if (!Array.isArray(translations)) {
    throw new Error('Response must include a translations array.');
  }

  const expectedIdSet = new Set(expectedIds);
  const result = new Map<string, string>();

  for (const item of translations) {
    if (!item || typeof item !== 'object') {
      throw new Error('Each translations item must be an object.');
    }
    const id = String((item as { id?: unknown }).id ?? '').trim();
    const text = String((item as { text?: unknown }).text ?? '').trim();
    if (!id) {
      throw new Error('Each translations item requires a non-empty id.');
    }
    if (!text) {
      throw new Error(`Translation text is empty for segment ${id}.`);
    }
    if (!expectedIdSet.has(id)) {
      throw new Error(`Unexpected segment id returned: ${id}.`);
    }
    if (result.has(id)) {
      throw new Error(`Duplicate segment id returned: ${id}.`);
    }
    result.set(id, text);
  }

  for (const expectedId of expectedIds) {
    if (!result.has(expectedId)) {
      throw new Error(`Missing translation for segment ${expectedId}.`);
    }
  }

  return result;
}

function extractJsonPayload(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  return raw.trim();
}

function readDialogueSpeaker(segment: Segment): string {
  return segment.meta?.context ? String(segment.meta.context).trim() : '';
}

function isUnchangedOutput(
  translatedText: string,
  sourceText: string,
  sourcePayload: string,
  srcLang: string,
  tgtLang: string,
): boolean {
  if (srcLang === tgtLang) {
    return false;
  }
  const trimmed = translatedText.trim();
  return trimmed === sourceText.trim() || trimmed === sourcePayload.trim();
}
