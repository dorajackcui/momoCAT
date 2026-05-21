import type {
  JobUnit,
  TranslationTask,
  UnitResult,
} from '../../job/types';
import { unitKey } from './unitIdentity';

export interface WindowModeContextInput {
  task: TranslationTask;
  jobUnits: JobUnit[];
  currentUnits: JobUnit[];
  completedResults: ReadonlyMap<string, UnitResult>;
  maxPreviousRows?: number;
  maxNextRows?: number;
}

export interface WindowModeContext {
  previousContext: Array<{ source: string; target: string }>;
  nextContext: Array<{ source: string }>;
}

export function mergeCompletedResults(
  completedResults: ReadonlyMap<string, UnitResult> | undefined,
  additionalResults: UnitResult[],
): Map<string, UnitResult> {
  const merged = new Map(completedResults);

  for (const result of additionalResults) {
    if (result.target?.trim()) {
      merged.set(unitKey(result), result);
    }
  }

  return merged;
}

export function buildWindowModeContext(input: WindowModeContextInput): WindowModeContext {
  const jobOrder = resolveJobOrder(input.jobUnits, input.task.units, input.currentUnits);
  const currentKeys = new Set(input.currentUnits.map(unitKey));
  const maxPreviousRows = input.maxPreviousRows ?? 5;
  const maxNextRows = input.maxNextRows ?? 5;
  let lastCurrentIndex = -1;

  for (let index = 0; index < jobOrder.length; index += 1) {
    if (currentKeys.has(unitKey(jobOrder[index]))) {
      lastCurrentIndex = index;
    }
  }

  if (lastCurrentIndex < 0) {
    return { previousContext: [], nextContext: [] };
  }

  const previousContext: Array<{ source: string; target: string }> = [];
  for (let index = lastCurrentIndex - 1; index >= 0 && previousContext.length < maxPreviousRows; index -= 1) {
    const unit = jobOrder[index];
    if (currentKeys.has(unitKey(unit))) {
      continue;
    }

    const completed = input.completedResults.get(unitKey(unit));
    const target = completed?.target;

    if (target?.trim()) {
      previousContext.push({ source: unit.source, target });
    }
  }

  const nextContext: Array<{ source: string }> = [];
  for (let index = lastCurrentIndex + 1; index < jobOrder.length && nextContext.length < maxNextRows; index += 1) {
    const source = jobOrder[index].source;

    if (source.trim()) {
      nextContext.push({ source });
    }
  }

  return {
    previousContext: previousContext.reverse(),
    nextContext,
  };
}

function resolveJobOrder(
  jobUnits: JobUnit[],
  taskUnits: JobUnit[],
  currentUnits: JobUnit[],
): JobUnit[] {
  if (jobUnits.length === 0) {
    return taskUnits;
  }

  const jobUnitKeys = new Set(jobUnits.map(unitKey));
  const allCurrentUnitsExist = currentUnits.every((unit) => jobUnitKeys.has(unitKey(unit)));

  return allCurrentUnitsExist ? jobUnits : taskUnits;
}
