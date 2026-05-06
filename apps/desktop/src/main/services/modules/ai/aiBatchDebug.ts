import { appendFile } from 'fs/promises';

export const AI_BATCH_DEBUG_ENV = 'CAT_AI_DEBUG_BATCH';
export const AI_BATCH_DEBUG_FILE_ENV = 'CAT_AI_DEBUG_BATCH_FILE';

const AI_PROMPT_DEBUG_ENV = 'CAT_AI_DEBUG_PROMPTS';

export interface AIBatchDebugLogParams {
  event: string;
  [key: string]: unknown;
}

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function isAIBatchDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyFlag(env[AI_BATCH_DEBUG_ENV]) || isTruthyFlag(env[AI_PROMPT_DEBUG_ENV]);
}

function getAIBatchDebugFilePath(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env[AI_BATCH_DEBUG_FILE_ENV]?.trim();
  return value ? value : null;
}

function formatConsoleValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(',');
  if (value === undefined || value === null) return '';
  return String(value).replace(/\s+/g, ' ').slice(0, 180);
}

function buildConsoleLine(params: AIBatchDebugLogParams): string {
  const preferredKeys = [
    'event',
    'mode',
    'fileId',
    'projectId',
    'segmentId',
    'segmentIds',
    'orderIndex',
    'stage',
    'status',
    'error',
  ];
  const seen = new Set(preferredKeys);
  const remainingKeys = Object.keys(params)
    .filter((key) => !seen.has(key))
    .sort();
  const entries = [...preferredKeys, ...remainingKeys]
    .filter((key) => params[key] !== undefined)
    .map((key) => `${key}=${formatConsoleValue(params[key])}`);

  return `[AIBatchDebug] ${entries.join(' ')}`;
}

export function logAIBatchDebug(params: AIBatchDebugLogParams): void {
  if (!isAIBatchDebugEnabled()) {
    return;
  }

  console.log(buildConsoleLine(params));

  const debugFilePath = getAIBatchDebugFilePath();
  if (!debugFilePath) {
    return;
  }

  const entry = {
    ts: new Date().toISOString(),
    ...params,
  };
  void appendFile(debugFilePath, `${JSON.stringify(entry)}\n`, 'utf8').catch((error) => {
    console.error('[AIBatchDebug] Failed to append UTF-8 batch log:', error);
  });
}
