import { parseAIWindowModeResponse } from '@cat/core/project';
import { parseEditorTextToTokens } from '@cat/core/tag';
import type { TagPolicy } from '@cat/core/tag';
import type { PromptArtifact } from '../artifacts';
import {
  errorMessage,
  type TranslationAuditContext,
  type TranslationAuditEvent,
} from '../audit/TranslationAudit';
import type { AITransport } from '../ports';
import type {
  MTBatchTranslateResult,
  MTBatchUnitResult,
  TranslatePreparedBatchPromptInput,
} from './MTModuleTypes';

interface MTBatchResponseProcessorInput {
  input: TranslatePreparedBatchPromptInput;
  prompt: PromptArtifact;
  tagPolicy: TagPolicy;
  aiTransport: AITransport;
  recordAudit: (context: TranslationAuditContext | undefined, event: TranslationAuditEvent) => void;
}

export async function processMTBatchResponse({
  input,
  prompt,
  tagPolicy,
  aiTransport,
  recordAudit,
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

  return { results, prompt };
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
