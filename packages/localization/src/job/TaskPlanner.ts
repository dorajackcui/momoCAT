import { unitKey } from '../requestModes/shared/unitIdentity';
import type { JobUnit, TranslationJob, TranslationTask, UnitResult } from './types';

export interface TaskPlanner {
  plan(units: JobUnit[]): TranslationTask[];
}

export interface JobAwareTaskPlanner {
  readonly supportsJobAwarePlanning: true;
  planJob(input: {
    job: TranslationJob;
    completedResults: ReadonlyMap<string, UnitResult>;
  }): TranslationTask[];
}

export interface WindowModeTaskPlannerOptions {
  batchSize?: number;
}

export class OneUnitTaskPlanner implements TaskPlanner {
  plan(units: JobUnit[]): TranslationTask[] {
    return units.map((unit, index) => ({
      taskId: `task-${index + 1}`,
      units: [unit],
    }));
  }
}

export class WindowModeTaskPlanner implements TaskPlanner {
  private readonly batchSize: number;

  constructor(options: WindowModeTaskPlannerOptions = {}) {
    this.batchSize = normalizeWindowModeBatchSize(options.batchSize);
  }

  plan(units: JobUnit[]): TranslationTask[] {
    const tasks: TranslationTask[] = [];

    for (let index = 0; index < units.length; index += this.batchSize) {
      tasks.push({
        taskId: `window-task-${tasks.length + 1}`,
        units: units.slice(index, index + this.batchSize),
      });
    }

    return tasks;
  }
}

export class WindowPartialTaskPlanner implements JobAwareTaskPlanner {
  readonly supportsJobAwarePlanning = true;

  private readonly batchSize: number;

  constructor(options: WindowModeTaskPlannerOptions = {}) {
    this.batchSize = normalizeWindowModeBatchSize(options.batchSize);
  }

  planJob(input: {
    job: TranslationJob;
    completedResults: ReadonlyMap<string, UnitResult>;
  }): TranslationTask[] {
    const tasks: TranslationTask[] = [];

    for (let index = 0; index < input.job.units.length; index += this.batchSize) {
      const scanWindowUnits = input.job.units.slice(index, index + this.batchSize);
      const units = scanWindowUnits.filter((unit) => !input.completedResults.has(unitKey(unit)));

      if (units.length === 0) {
        continue;
      }

      tasks.push({
        taskId: `window-partial-task-${Math.floor(index / this.batchSize) + 1}`,
        requestMode: 'window-partial',
        scanWindowUnits,
        units,
        requestUnitKeys: units.filter(shouldRequestUnit).map(unitKey),
      });
    }

    return tasks;
  }
}

export function normalizeWindowModeBatchSize(value: number | undefined): number {
  if (value === undefined) {
    return 5;
  }

  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error('Window Mode batchSize must be an integer from 1 to 5.');
  }

  return value;
}

function shouldRequestUnit(unit: JobUnit): boolean {
  if (unit.locked) {
    return false;
  }

  if (!unit.source.trim()) {
    return false;
  }

  return !unit.target?.trim();
}
