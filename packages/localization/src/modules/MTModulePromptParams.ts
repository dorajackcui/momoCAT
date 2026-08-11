import type { Segment } from '@cat/core/models';
import { normalizeProjectType, type ProjectType } from '@cat/core/project';
import { serializeTokensToEditorText } from '@cat/core/tag';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { TBArtifact, TMArtifact } from '../artifacts';
import { resolveTagPolicy } from '../tagPolicy';
import type { ComposeBatchPromptInput, ComposePromptInput } from './MTModuleTypes';

export interface PromptParams {
  projectPrompt: string;
  projectType: ProjectType;
  sourceText: string;
  sourceTagPreservedText: string;
  context: string;
  currentTranslationPayload?: string;
  refinementInstruction?: string;
  validationFeedback?: string;
  references: {
    tmReference?: TMArtifact['selectedReferences']['tmReferences'][number];
    tmReferences?: TMArtifact['selectedReferences']['tmReferences'];
    concordanceReferences?: TMArtifact['selectedReferences']['concordanceReferences'];
    tbReferences?: TBArtifact['selectedReferences'];
  };
}

export interface BatchPromptParams {
  projectPrompt: string;
  projectType: ProjectType;
  validationFeedback?: string;
  currentSegments: Array<{
    id: string;
    sourcePayload: string;
    context?: string;
    tmReferences?: TMArtifact['selectedReferences']['tmReferences'];
    concordanceReferences?: TMArtifact['selectedReferences']['concordanceReferences'];
    tbReferences?: TBArtifact['selectedReferences'];
  }>;
}

export function buildPromptParams(
  input: ComposePromptInput & { validationFeedback?: string },
): PromptParams {
  const sourceText = serializeTokensToDisplayText(input.segment.sourceTokens);
  const sourceTagPreservedText = serializeSourcePayload(
    input.segment.sourceTokens,
    input.tagPolicy,
  );
  const context =
    input.context !== undefined
      ? input.context.trim()
      : input.segment.meta?.context
        ? String(input.segment.meta.context).trim()
        : '';
  const tmReferences = input.tm.selectedReferences.tmReferences;
  const concordanceReferences = input.tm.selectedReferences.concordanceReferences;
  const tbReferences = input.tb.selectedReferences;

  return {
    projectPrompt:
      input.projectPromptOverride ?? input.mtOptions?.systemPrompt ?? input.project.aiPrompt ?? '',
    projectType: normalizeProjectType(input.project.projectType),
    sourceText,
    sourceTagPreservedText,
    context,
    currentTranslationPayload: input.currentTranslationPayload,
    refinementInstruction: input.refinementInstruction,
    validationFeedback: input.validationFeedback,
    references: {
      tmReference: tmReferences[0],
      tmReferences: tmReferences.length > 0 ? tmReferences : undefined,
      concordanceReferences: concordanceReferences.length > 0 ? concordanceReferences : undefined,
      tbReferences: tbReferences.length > 0 ? tbReferences : undefined,
    },
  };
}

export function buildBatchPromptParams(
  input: ComposeBatchPromptInput & { validationFeedback?: string },
): BatchPromptParams {
  const currentSegments = input.current.map((unit) => {
    const sourcePayload = serializeSourcePayload(unit.segment.sourceTokens, input.tagPolicy);
    const context =
      unit.context ??
      (unit.segment.meta?.context ? String(unit.segment.meta.context).trim() : undefined);
    const tmReferences = unit.tm.selectedReferences.tmReferences;
    const concordanceReferences = unit.tm.selectedReferences.concordanceReferences;
    const tbReferences = unit.tb.selectedReferences;

    return {
      id: unit.responseId,
      sourcePayload,
      context,
      tmReferences: tmReferences.length > 0 ? tmReferences : undefined,
      concordanceReferences:
        concordanceReferences.length > 0 ? concordanceReferences : undefined,
      tbReferences: tbReferences.length > 0 ? tbReferences : undefined,
    };
  });

  return {
    projectPrompt:
      input.projectPromptOverride ?? input.mtOptions?.systemPrompt ?? input.project.aiPrompt ?? '',
    projectType: normalizeProjectType(input.project.projectType),
    validationFeedback: input.validationFeedback,
    currentSegments,
  };
}

function serializeSourcePayload(tokens: Segment['sourceTokens'], rawPolicy: unknown): string {
  const sourceText = serializeTokensToDisplayText(tokens);
  const tagPolicy = resolveTagPolicy(rawPolicy);
  return tagPolicy === 'none' ? sourceText : serializeTokensToEditorText(tokens, tokens);
}
