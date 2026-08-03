import type { CancellationToken } from './job/types';
import { sourceTerminologyDocumentUnitKey } from './sourceTerminologyAggregation';
import type {
  SourceTerminologyUnit,
  SourceTerminologyUnitResult,
} from './SourceTerminologyExtractor';

export const SOURCE_TERMINOLOGY_CANCELLED = Symbol('source-terminology-cancelled');

export function isSourceTerminologyCancellationRequested(
  cancellationToken?: CancellationToken,
): boolean {
  return cancellationToken?.isCancellationRequested() === true;
}

export function cancelledSourceTerminologyUnitResult(
  unit: SourceTerminologyUnit,
): SourceTerminologyUnitResult {
  return { ...unit, sourceTerms: [], status: 'cancelled' };
}

export function setCancelledSourceTerminologyUnitResults(
  resultByDocumentUnit: Map<string, SourceTerminologyUnitResult>,
  units: SourceTerminologyUnit[],
): void {
  for (const unit of units) {
    resultByDocumentUnit.set(
      sourceTerminologyDocumentUnitKey(unit),
      cancelledSourceTerminologyUnitResult(unit),
    );
  }
}
