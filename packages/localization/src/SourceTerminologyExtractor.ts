import {
  buildSourceTerminologyPromptBundle,
  parseSourceTerminologyResponse,
} from '@cat/core/project';
import { normalizeTermForLookup } from '@cat/core/text';
import type { AIProviderCatalogService } from './providers/AIProviderCatalogService';
import type { AIRuntimeConfigProvider, AITransport } from './ports';
import { runBounded } from './RequestScheduler';
import {
  buildSourceTerminologyExtractionResult,
  sourceTerminologyDocumentUnitKey,
} from './sourceTerminologyAggregation';
import { isWholeSourceTerminologyEquivalent } from './sourceTerminologyEquivalence';

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_MAX_PROMPT_CHARS = 30000;
const DEFAULT_MAX_ATTEMPTS = 2;
export interface SourceTerminologyHistoricalTerm {
  sourceTerm: string;
  targetTerm?: string;
  note?: string | null;
}

export interface SourceTerminologyUnit {
  documentId: string;
  unitId: string;
  source: string;
  rowNumber?: number;
  historicalTerms?: SourceTerminologyHistoricalTerm[];
  metadata?: Record<string, unknown>;
}

export interface SourceTerminologyUnitResult extends SourceTerminologyUnit {
  sourceTerms: string[];
  status: 'ready' | 'error';
  error?: string;
}

export interface SourceTerminologyAggregate {
  sourceTerm: string;
  variants: string[];
  occurrences: number;
  documentUnitIds: string[];
  rowNumbers: number[];
  sampleSources: string[];
  status: 'candidate';
}

export interface SourceTerminologyExtractionResult {
  units: SourceTerminologyUnitResult[];
  terms: SourceTerminologyAggregate[];
  summary: {
    total: number;
    ready: number;
    error: number;
    uniqueTerms: number;
  };
}

export interface SourceTerminologyExtractionInput {
  sourceLanguage: string;
  providerId?: string | null;
  units: SourceTerminologyUnit[];
  options?: {
    batchSize?: number;
    maxPromptChars?: number;
    maxAttempts?: number;
    maxConcurrency?: number;
  };
  onProgress?: (current: number, total: number) => void;
}

export interface SourceTerminologyExtractorDependencies {
  providerCatalogService: Pick<AIProviderCatalogService, 'resolveProviderConfig'>;
  aiRuntimeConfigProvider: AIRuntimeConfigProvider;
  aiTransport: AITransport;
}

interface SourceTerminologyGroup {
  requestId: string;
  representative: SourceTerminologyUnit;
  units: SourceTerminologyUnit[];
}

export class SourceTerminologyExtractor {
  constructor(private readonly deps: SourceTerminologyExtractorDependencies) {}

  async extract(
    input: SourceTerminologyExtractionInput,
  ): Promise<SourceTerminologyExtractionResult> {
    const sourceLanguage = input.sourceLanguage.trim();
    if (!sourceLanguage) {
      throw new Error('Source terminology extraction requires a source language.');
    }

    const units = normalizeUnits(input.units);
    input.onProgress?.(0, units.length);
    if (units.length === 0) {
      return buildSourceTerminologyExtractionResult([], sourceLanguage);
    }

    const batchSize = validateIntegerOption(
      input.options?.batchSize,
      'batchSize',
      DEFAULT_BATCH_SIZE,
      1,
      10,
    );
    const maxPromptChars = validateIntegerOption(
      input.options?.maxPromptChars,
      'maxPromptChars',
      DEFAULT_MAX_PROMPT_CHARS,
      1000,
      1000000,
    );
    const maxAttempts = validateIntegerOption(
      input.options?.maxAttempts,
      'maxAttempts',
      DEFAULT_MAX_ATTEMPTS,
      1,
      3,
    );
    const maxConcurrency = validatePositiveIntegerOption(
      input.options?.maxConcurrency,
      'maxConcurrency',
    );
    const groups = groupEquivalentUnits(units, sourceLanguage);
    const batches = packGroups(groups, batchSize, maxPromptChars);
    const { provider, apiKey } = this.deps.providerCatalogService.resolveProviderConfig(
      input.providerId,
    );
    const runtimeConfig = await this.deps.aiRuntimeConfigProvider.getModelConfig(provider.model);
    const resultByDocumentUnit = new Map<string, SourceTerminologyUnitResult>();
    let completed = 0;

    const scheduled = await runBounded(
      batches,
      async (batch) => {
        try {
          const termsByRequestId = await this.extractBatch({
            sourceLanguage,
            batch,
            maxAttempts,
            provider: {
              apiKey,
              baseUrl: provider.baseUrl,
              model: provider.model,
              reasoningEffort: runtimeConfig.reasoningEffort,
            },
          });

          for (const group of batch) {
            const sourceTerms = filterSourceTerms({
              source: group.representative.source,
              sourceLanguage,
              historicalTerms: group.representative.historicalTerms ?? [],
              candidates: termsByRequestId.get(group.requestId) ?? [],
            });
            for (const unit of group.units) {
              resultByDocumentUnit.set(sourceTerminologyDocumentUnitKey(unit), {
                ...unit,
                sourceTerms: [...sourceTerms],
                status: 'ready',
              });
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          for (const group of batch) {
            for (const unit of group.units) {
              resultByDocumentUnit.set(sourceTerminologyDocumentUnitKey(unit), {
                ...unit,
                sourceTerms: [],
                status: 'error',
                error: message,
              });
            }
          }
        }

        completed += batch.reduce((total, group) => total + group.units.length, 0);
        input.onProgress?.(completed, units.length);
      },
      { maxConcurrency },
    );
    const schedulerFailure = scheduled.find((result) => result.status === 'rejected');
    if (schedulerFailure?.status === 'rejected') {
      throw schedulerFailure.reason;
    }

    return buildSourceTerminologyExtractionResult(
      units.map((unit) => {
        const result = resultByDocumentUnit.get(sourceTerminologyDocumentUnitKey(unit));
        if (!result) {
          throw new Error(`Missing source terminology result for unit "${unit.unitId}".`);
        }
        return result;
      }),
      sourceLanguage,
    );
  }

  private async extractBatch(input: {
    sourceLanguage: string;
    batch: SourceTerminologyGroup[];
    maxAttempts: number;
    provider: {
      apiKey: string;
      baseUrl: string;
      model: string;
      reasoningEffort: Awaited<
        ReturnType<AIRuntimeConfigProvider['getModelConfig']>
      >['reasoningEffort'];
    };
  }): Promise<Map<string, string[]>> {
    const expectedIds = input.batch.map((group) => group.requestId);
    let validationFeedback: string | undefined;
    let lastError: unknown;

    for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
      const prompt = buildSourceTerminologyPromptBundle({
        sourceLanguage: input.sourceLanguage,
        units: input.batch.map((group) => ({
          id: group.requestId,
          source: group.representative.source,
          historicalTerms: (group.representative.historicalTerms ?? []).map((term) => ({
            sourceTerm: term.sourceTerm,
          })),
        })),
        validationFeedback,
      });

      const response = await this.deps.aiTransport.createResponse({
        ...input.provider,
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
      });
      try {
        const parsed = parseSourceTerminologyResponse(response.content, expectedIds);
        return new Map(
          parsed.map((segment) => [segment.id, segment.terms.map((term) => term.sourceTerm)]),
        );
      } catch (error) {
        lastError = error;
        validationFeedback = error instanceof Error ? error.message : String(error);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Source terminology extraction failed: ${String(lastError)}`);
  }
}

function normalizeUnits(units: SourceTerminologyUnit[]): SourceTerminologyUnit[] {
  const seenKeys = new Set<string>();
  return units.map((unit) => {
    const documentId = unit.documentId.trim();
    const unitId = unit.unitId.trim();
    const source = unit.source.trim();
    if (!documentId || !unitId) {
      throw new Error('Source terminology units require documentId and unitId.');
    }
    if (!source) {
      throw new Error(`Source terminology unit "${unitId}" must contain source text.`);
    }
    const key = sourceTerminologyDocumentUnitKey({ ...unit, documentId, unitId });
    if (seenKeys.has(key)) {
      throw new Error(`Duplicate source terminology unit identity "${key}".`);
    }
    seenKeys.add(key);

    return {
      ...unit,
      documentId,
      unitId,
      source,
      historicalTerms: (unit.historicalTerms ?? [])
        .map((term) => ({
          sourceTerm: term.sourceTerm.trim(),
          ...(term.targetTerm?.trim() ? { targetTerm: term.targetTerm.trim() } : {}),
          ...(term.note?.trim() ? { note: term.note.trim() } : {}),
        }))
        .filter((term) => term.sourceTerm.length > 0),
    };
  });
}

function groupEquivalentUnits(
  units: SourceTerminologyUnit[],
  sourceLanguage: string,
): SourceTerminologyGroup[] {
  const groupsByKey = new Map<string, SourceTerminologyGroup>();
  const groups: SourceTerminologyGroup[] = [];

  for (const unit of units) {
    const historicalKey = (unit.historicalTerms ?? [])
      .map((term) => normalizeTermForLookup(term.sourceTerm, { locale: sourceLanguage }))
      .sort()
      .join('\u001f');
    const key = `${unit.source}\u001e${historicalKey}`;
    const existing = groupsByKey.get(key);
    if (existing) {
      existing.units.push(unit);
      continue;
    }

    const group = {
      requestId: `source-term-${groups.length + 1}`,
      representative: unit,
      units: [unit],
    };
    groupsByKey.set(key, group);
    groups.push(group);
  }

  return groups;
}

function packGroups(
  groups: SourceTerminologyGroup[],
  batchSize: number,
  maxPromptChars: number,
): SourceTerminologyGroup[][] {
  const batches: SourceTerminologyGroup[][] = [];
  let current: SourceTerminologyGroup[] = [];
  let currentChars = 0;

  for (const group of groups) {
    const estimatedChars =
      group.representative.source.length +
      (group.representative.historicalTerms ?? []).reduce(
        (total, term) => total + term.sourceTerm.length + 16,
        0,
      ) +
      300;
    if (
      current.length > 0 &&
      (current.length >= batchSize || currentChars + estimatedChars > maxPromptChars)
    ) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(group);
    currentChars += estimatedChars;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function filterSourceTerms(input: {
  source: string;
  sourceLanguage: string;
  historicalTerms: SourceTerminologyHistoricalTerm[];
  candidates: string[];
}): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();

  for (const rawCandidate of input.candidates) {
    const candidate = rawCandidate.trim();
    if (!candidate || !input.source.includes(candidate)) continue;
    const normalized = normalizeTermForLookup(candidate, { locale: input.sourceLanguage });
    if (!normalized || seen.has(normalized)) continue;
    if (
      input.historicalTerms.some((historicalTerm) =>
        isWholeSourceTerminologyEquivalent(
          candidate,
          historicalTerm.sourceTerm,
          input.sourceLanguage,
        ),
      )
    ) {
      continue;
    }
    seen.add(normalized);
    terms.push(candidate);
  }

  return terms;
}

function validateIntegerOption(
  value: number | undefined,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return resolved;
}

function validatePositiveIntegerOption(
  value: number | undefined,
  name: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}
