import type { JobUnit, TranslationTask } from './types';

export interface TaskPlanner {
  plan(units: JobUnit[]): TranslationTask[];
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

export function normalizeWindowModeBatchSize(value: number | undefined): number {
  if (value === undefined) {
    return 5;
  }

  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error('Window Mode batchSize must be an integer from 1 to 5.');
  }

  return value;
}
