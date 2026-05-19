import { createHash } from 'crypto';

export interface SourceHashInput {
  source: string;
  context?: string;
  // Accepted for callers that pass unit-like objects; target is intentionally
  // excluded from resume identity so target-only edits do not invalidate reuse.
  target?: string;
}

export function computeSourceHash(input: SourceHashInput): string {
  const payload: Array<[string, string]> = [['source', input.source]];

  if (input.context !== undefined) {
    payload.push(['context', input.context]);
  }

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
