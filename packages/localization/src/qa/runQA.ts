import type { Segment, TBMatch } from '@cat/core/models';
import { evaluateDocumentQa, type DocumentQaOptions } from '@cat/core/qa';
import { normalizeQASettings } from '@cat/core/project';

export interface RunQAInput extends Omit<DocumentQaOptions, 'termMatches'> {
  evaluate?: (
    segments: readonly Segment[],
    options: DocumentQaOptions,
  ) => Promise<ReturnType<typeof evaluateDocumentQa>>;
  segments: readonly Segment[];
  resolveTermMatches?: (segment: Segment) => Promise<TBMatch[]>;
  signal?: AbortSignal;
  onProgress?: (checked: number, total: number) => void;
}

/** Shared desktop / CLI workflow. Hosts own input loading and result persistence. */
export async function runQA(input: RunQAInput) {
  const settings = normalizeQASettings(input.settings);
  const termMatches = new Map<string, TBMatch[]>();
  // The mounted-term resolver depends on source tokens, including tag boundaries.
  // Repeated sources share lookup work but retain their own result rows.
  const bySource = new Map<string, TBMatch[]>();
  for (let index = 0; index < input.segments.length; index++) {
    input.signal?.throwIfAborted();
    const segment = input.segments[index];
    if (settings.enabledRuleIds.includes('terminology-consistency') && input.resolveTermMatches) {
      const key = JSON.stringify(segment.sourceTokens);
      let matches = bySource.get(key);
      if (!matches) {
        matches = await input.resolveTermMatches(segment);
        bySource.set(key, matches);
      }
      termMatches.set(segment.segmentId, matches);
    }
    if (index % 100 === 0) {
      input.onProgress?.(index, input.segments.length);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  input.signal?.throwIfAborted();
  const options: DocumentQaOptions = {
    settings,
    termMatches,
    sourceLocale: input.sourceLocale,
    targetLocale: input.targetLocale,
    tagPolicy: input.tagPolicy,
  };
  const report = input.evaluate
    ? await input.evaluate(input.segments, options)
    : evaluateDocumentQa(input.segments, options);
  input.onProgress?.(input.segments.length, input.segments.length);
  return report;
}
