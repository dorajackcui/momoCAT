import type { ProjectType } from '@cat/core/project';
import { parseAIWindowModeResponse } from '@cat/core/project';
import type { TagValidator } from '@cat/core/qa';
import { parseEditorTextToTokens } from '@cat/core/tag';
import type { TagPolicy } from '@cat/core/tag';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { PromptArtifact } from '../artifacts';
import {
  errorMessage,
  summarizeAuditText,
  type TranslationAuditContext,
  type TranslationAuditEvent,
} from '../audit/TranslationAudit';
import type { AITransport } from '../ports';
import type {
  MTBatchCurrentUnitInput,
  MTBatchTranslateResult,
  MTBatchUnitResult,
  TranslatePreparedBatchPromptInput,
} from './MTModuleTypes';

interface MTBatchResponseProcessorInput {
  input: TranslatePreparedBatchPromptInput;
  prompt: PromptArtifact;
  projectType: ProjectType;
  tagPolicy: TagPolicy;
  aiTransport: AITransport;
  tagValidator: TagValidator;
  recordAudit: (
    context: TranslationAuditContext | undefined,
    event: TranslationAuditEvent,
  ) => void;
  repairInvalidResult: (
    unit: MTBatchCurrentUnitInput,
    parsedResult: MTBatchUnitResult,
    validationFeedback: string,
  ) => Promise<MTBatchUnitResult>;
}

export async function processMTBatchResponse({
  input,
  prompt,
  projectType,
  tagPolicy,
  aiTransport,
  tagValidator,
  recordAudit,
  repairInvalidResult,
}: MTBatchResponseProcessorInput): Promise<MTBatchTranslateResult> {
  const currentByResponseId = new Map(input.current.map((unit) => [unit.responseId, unit]));
  const audit = input.audit;
  if (audit) {
    recordAudit(audit, {
      event: 'mt_batch_request',
      job: audit.jobId,
      task: input.taskId,
      mode: input.requestMode === 'window-partial' ? 'window-partial' : 'window',
      units: input.current.map((unit) => ({
        doc: unit.documentId,
        unit: unit.unitId,
        rid: unit.responseId,
        row: unit.rowNumber,
      })),
    });
  }

  const startedAt = Date.now();
  let translations: Array<{ id: string; text: string }>;
  let results: MTBatchUnitResult[];
  try {
    const response = await aiTransport.createResponse({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      model: input.model,
      reasoningEffort: input.reasoningEffort ?? 'medium',
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
    });

    translations = parseBatchResponse(
      response.content,
      input.current.map((unit) => unit.responseId),
    );
    results = translations.map((translation) => {
      const unit = currentByResponseId.get(translation.id);
      if (!unit) throw new Error(`Unknown translation id: ${translation.id}`);
      return {
        documentId: unit.documentId,
        unitId: unit.unitId,
        responseId: translation.id,
        targetTokens: parseEditorTextToTokens(translation.text, unit.segment.sourceTokens, {
          tagPolicy,
        }),
      };
    });
    if (audit) {
      recordAudit(audit, {
        event: 'mt_batch_response',
        job: audit.jobId,
        task: input.taskId,
        latencyMs: Date.now() - startedAt,
        returnedIds: translations.map((translation) => translation.id),
      });
    }
  } catch (error) {
    if (audit) {
      recordAudit(audit, {
        event: 'mt_batch_error',
        job: audit.jobId,
        task: input.taskId,
        latencyMs: Date.now() - startedAt,
        message: errorMessage(error),
      });
    }
    throw error;
  }

  if (projectType === 'custom' || tagPolicy === 'none') return { results, prompt };

  const invalidResults = results.flatMap((result) => {
    const unit = currentByResponseId.get(result.responseId);
    if (!unit) return [];
    const errors = tagValidator
      .validate(unit.segment.sourceTokens, result.targetTokens)
      .issues.filter((issue) => issue.severity === 'error');

    return errors.length === 0
      ? []
      : [
          {
            unit,
            parsedResult: result,
            validationMessages: errors.map((issue) => issue.message),
          },
        ];
  });

  if (invalidResults.length === 0) return { results, prompt };

  const repairedByResponseId = new Map<string, MTBatchUnitResult>();
  for (const invalidResult of invalidResults) {
    const validationFeedback = [
      'Previous Window Mode batch result was invalid.',
      ...invalidResult.validationMessages.map((message) => `- ${message}`),
      'Retry by preserving marker content and sequence exactly.',
    ].join('\n');
    const invalidTarget = serializeTokensToDisplayText(invalidResult.parsedResult.targetTokens);
    const invalidSummary = summarizeAuditText(invalidTarget)!;
    if (audit) {
      recordAudit(audit, {
        event: 'mt_tag_invalid',
        job: audit.jobId,
        task: input.taskId,
        unit: invalidResult.unit.unitId,
        rid: invalidResult.parsedResult.responseId,
        messages: invalidResult.validationMessages,
        targetHash: invalidSummary.targetHash,
        targetChars: invalidSummary.targetChars,
      });
      recordAudit(audit, {
        event: 'mt_repair_request',
        job: audit.jobId,
        task: input.taskId,
        unit: invalidResult.unit.unitId,
        rid: invalidResult.parsedResult.responseId,
        reason: 'tag_invalid',
      });
    }

    try {
      const repaired = await repairInvalidResult(
        invalidResult.unit,
        invalidResult.parsedResult,
        validationFeedback,
      );
      const repairedTarget = serializeTokensToDisplayText(repaired.targetTokens);
      const repairedSummary = summarizeAuditText(repairedTarget)!;
      if (audit) {
        recordAudit(audit, {
          event: 'mt_repair_success',
          job: audit.jobId,
          task: input.taskId,
          unit: invalidResult.unit.unitId,
          rid: invalidResult.parsedResult.responseId,
          targetHash: repairedSummary.targetHash,
          targetChars: repairedSummary.targetChars,
        });
      }
      repairedByResponseId.set(invalidResult.parsedResult.responseId, repaired);
    } catch (error) {
      if (audit) {
        recordAudit(audit, {
          event: 'mt_repair_failed',
          job: audit.jobId,
          task: input.taskId,
          unit: invalidResult.unit.unitId,
          rid: invalidResult.parsedResult.responseId,
          message: errorMessage(error),
        });
      }
      throw error;
    }
  }

  return {
    results: results.map((result) => repairedByResponseId.get(result.responseId) ?? result),
    prompt,
  };
}

function parseBatchResponse(content: string, expectedIds: string[]) {
  try {
    return parseAIWindowModeResponse(content, expectedIds);
  } catch (error) {
    if (error instanceof Error) {
      const missing = /^Missing translation id "(.+)"\.$/i.exec(error.message);
      if (missing) throw new Error(`Missing translation id: ${missing[1]}`);
    }
    throw error;
  }
}
