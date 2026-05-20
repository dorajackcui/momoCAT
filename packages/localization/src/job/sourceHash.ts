import { createHash } from 'crypto';

export interface SourceHashInput {
  source: string;
  context?: string;
  resumeFingerprint?: string;
  // Accepted for callers that pass unit-like objects; target is intentionally
  // excluded from resume identity so target-only edits do not invalidate reuse.
  target?: string;
}

export function computeSourceHash(input: SourceHashInput): string {
  const payload: Array<[string, string]> = [['source', input.source]];

  if (input.context !== undefined) {
    payload.push(['context', input.context]);
  }

  if (input.resumeFingerprint !== undefined) {
    payload.push(['resumeFingerprint', input.resumeFingerprint]);
  }

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
