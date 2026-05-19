import type { JobUnit, TranslationTask } from './types';

export interface TaskPlanner {
  plan(units: JobUnit[]): TranslationTask[];
}

export class OneUnitTaskPlanner implements TaskPlanner {
  plan(units: JobUnit[]): TranslationTask[] {
    return units.map((unit, index) => ({
      taskId: `task-${index + 1}`,
      units: [unit],
    }));
  }
}
