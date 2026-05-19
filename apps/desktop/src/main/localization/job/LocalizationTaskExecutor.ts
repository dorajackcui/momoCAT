import type { LocalizationEngine } from '../LocalizationEngine';
import type { TranslationTaskExecutor } from './types';

export function createLocalizationTaskExecutor(
  engine: Pick<LocalizationEngine, 'executeTranslationTask'>,
): TranslationTaskExecutor {
  return (task, context) => engine.executeTranslationTask(task, context);
}
