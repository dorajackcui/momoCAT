import { createHash } from 'crypto';

export interface SourceHashInput {
  source: string;
  context?: string;
  target?: string;
}

export function computeSourceHash(input: SourceHashInput): string {
  const payload: Array<[string, string]> = [['source', input.source]];

  if (input.context !== undefined) {
    payload.push(['context', input.context]);
  }

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
