import type { TranslationTaskExecutor } from './types';

type LocalizationTaskExecutorHost = {
  executeTranslationTask: TranslationTaskExecutor;
};

export function createLocalizationTaskExecutor(
  engine: LocalizationTaskExecutorHost,
): TranslationTaskExecutor {
  return (task, context) => engine.executeTranslationTask(task, context);
}
