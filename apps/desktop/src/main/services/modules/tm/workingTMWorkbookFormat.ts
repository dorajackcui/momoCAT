import type { Token } from '@cat/core/models';

export const WORKING_TM_SOURCE_TOKENS_HEADER = '__momoCAT_SourceTokens_v1';
export const WORKING_TM_TARGET_TOKENS_HEADER = '__momoCAT_TargetTokens_v1';

interface TokenMetadataEnvelope {
  version: 1;
  tokens: Token[];
}

export interface WorkingTMMetadataColumns {
  sourceTokensCol: number;
  targetTokensCol: number;
}

export function serializeWorkingTMTokenMetadata(tokens: Token[]): string {
  const envelope: TokenMetadataEnvelope = { version: 1, tokens };
  return JSON.stringify(envelope);
}

export function parseWorkingTMTokenMetadata(value: unknown): Token[] | null {
  if (typeof value !== 'string' || value.length === 0) return null;

  try {
    const parsed = JSON.parse(value) as { version?: unknown; tokens?: unknown };
    if (parsed?.version !== 1 || !Array.isArray(parsed.tokens) || parsed.tokens.length === 0) {
      return null;
    }
    if (!parsed.tokens.every(isToken)) return null;
    return parsed.tokens;
  } catch {
    return null;
  }
}

export function findWorkingTMMetadataColumns(
  headerCells: Array<string | number | boolean | null | undefined>,
): WorkingTMMetadataColumns | null {
  const sourceTokensCol = headerCells.findIndex((cell) => cell === WORKING_TM_SOURCE_TOKENS_HEADER);
  const targetTokensCol = headerCells.findIndex((cell) => cell === WORKING_TM_TARGET_TOKENS_HEADER);

  return sourceTokensCol >= 0 && targetTokensCol >= 0 ? { sourceTokensCol, targetTokensCol } : null;
}

export function stripWorkingTMMetadataColumns(
  cells: Array<string | number | boolean | null | undefined>,
  columns: WorkingTMMetadataColumns | null,
): Array<string | number | boolean | null | undefined> {
  if (!columns) return cells;
  return cells.filter(
    (_cell, index) => index !== columns.sourceTokensCol && index !== columns.targetTokensCol,
  );
}

function isToken(value: unknown): value is Token {
  if (!value || typeof value !== 'object') return false;
  const token = value as { type?: unknown; content?: unknown; meta?: unknown };
  if (!['text', 'tag', 'locked', 'ws'].includes(String(token.type))) return false;
  if (typeof token.content !== 'string') return false;
  return token.meta === undefined || (!!token.meta && typeof token.meta === 'object');
}
