import { appendFile } from 'fs/promises';
import type { ReasoningEffort } from '../../ports';

export const AI_PROMPT_DEBUG_ENV = 'CAT_AI_DEBUG_PROMPTS';
export const AI_PROMPT_DEBUG_FILE_ENV = 'CAT_AI_DEBUG_PROMPTS_FILE';

interface PromptDebugLogParams {
  flow: 'segment' | 'refine' | 'test' | 'dialogue';
  model: string;
  reasoningEffort?: ReasoningEffort;
  systemPrompt: string;
  userPrompt: string;
  attempt?: number;
  segmentId?: string;
  segmentIds?: string[];
}

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function isAIPromptDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyFlag(env[AI_PROMPT_DEBUG_ENV]);
}

function getAIPromptDebugFilePath(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env[AI_PROMPT_DEBUG_FILE_ENV]?.trim();
  return value ? value : null;
}

function buildPromptDebugBlock(params: PromptDebugLogParams): string {
  const details = [
    `flow=${params.flow}`,
    `model=${params.model}`,
    params.reasoningEffort ? `reasoning=${params.reasoningEffort}` : null,
    typeof params.attempt === 'number' ? `attempt=${params.attempt}` : null,
    params.segmentId ? `segmentId=${params.segmentId}` : null,
    params.segmentIds?.length ? `segmentIds=${params.segmentIds.join(',')}` : null,
  ].filter((value): value is string => Boolean(value));

  return [
    `[${new Date().toISOString()}] ${details.join(' ')}`,
    '[systemPrompt]',
    params.systemPrompt,
    '',
    '[userPrompt]',
    params.userPrompt,
    '',
    '',
  ].join('\n');
}

export function logAIPromptDebug(params: PromptDebugLogParams): void {
  if (!isAIPromptDebugEnabled()) {
    return;
  }

  const details = [
    `flow=${params.flow}`,
    `model=${params.model}`,
    params.reasoningEffort ? `reasoning=${params.reasoningEffort}` : null,
    typeof params.attempt === 'number' ? `attempt=${params.attempt}` : null,
    params.segmentId ? `segmentId=${params.segmentId}` : null,
    params.segmentIds?.length ? `segmentIds=${params.segmentIds.join(',')}` : null,
  ].filter((value): value is string => Boolean(value));

  console.log(`[AIPromptDebug] ${details.join(' ')}`);
  console.log(`[AIPromptDebug][systemPrompt]\n${params.systemPrompt}`);
  console.log(`[AIPromptDebug][userPrompt]\n${params.userPrompt}`);

  const debugFilePath = getAIPromptDebugFilePath();
  if (!debugFilePath) {
    return;
  }

  void appendFile(debugFilePath, buildPromptDebugBlock(params), 'utf8').catch((error) => {
    console.error('[AIPromptDebug] Failed to append UTF-8 prompt log:', error);
  });
}
