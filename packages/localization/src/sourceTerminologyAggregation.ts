import { normalizeTermForLookup } from '@cat/core/text';
import type {
  SourceTerminologyAggregate,
  SourceTerminologyExtractionResult,
  SourceTerminologyUnit,
  SourceTerminologyUnitResult,
} from './SourceTerminologyExtractor';

export function buildSourceTerminologyExtractionResult(
  units: SourceTerminologyUnitResult[],
  sourceLanguage: string,
): SourceTerminologyExtractionResult {
  const termsByKey = new Map<
    string,
    SourceTerminologyAggregate & { variantSet: Set<string>; rowNumberSet: Set<number> }
  >();

  for (const unit of units) {
    if (unit.status !== 'ready') continue;
    for (const sourceTerm of unit.sourceTerms) {
      const key = normalizeTermForLookup(sourceTerm, { locale: sourceLanguage });
      const documentUnitId = sourceTerminologyDocumentUnitKey(unit);
      const existing = termsByKey.get(key);
      if (existing) {
        existing.occurrences += 1;
        existing.variantSet.add(sourceTerm);
        existing.documentUnitIds.push(documentUnitId);
        if (unit.rowNumber !== undefined) existing.rowNumberSet.add(unit.rowNumber);
        if (existing.sampleSources.length < 3 && !existing.sampleSources.includes(unit.source)) {
          existing.sampleSources.push(unit.source);
        }
        continue;
      }

      termsByKey.set(key, {
        sourceTerm,
        variants: [],
        variantSet: new Set([sourceTerm]),
        occurrences: 1,
        documentUnitIds: [documentUnitId],
        rowNumbers: [],
        rowNumberSet: new Set(unit.rowNumber === undefined ? [] : [unit.rowNumber]),
        sampleSources: [unit.source],
        status: 'candidate',
      });
    }
  }

  const terms = Array.from(termsByKey.values()).map(({ variantSet, rowNumberSet, ...term }) => ({
    ...term,
    variants: Array.from(variantSet).filter((variant) => variant !== term.sourceTerm),
    rowNumbers: Array.from(rowNumberSet).sort((a, b) => a - b),
  }));

  return {
    units,
    terms,
    summary: {
      total: units.length,
      ready: units.filter((unit) => unit.status === 'ready').length,
      error: units.filter((unit) => unit.status === 'error').length,
      cancelled: units.filter((unit) => unit.status === 'cancelled').length,
      uniqueTerms: terms.length,
    },
  };
}

export function sourceTerminologyDocumentUnitKey(
  unit: Pick<SourceTerminologyUnit, 'documentId' | 'unitId'>,
): string {
  return `${unit.documentId}\u001f${unit.unitId}`;
}
