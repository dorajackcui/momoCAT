import { describe, expect, it } from 'vitest';
import { buildFileTranslationResumeFingerprint } from './FileResumeFingerprint';

describe('Translation resume identity', () => {
  it('retains the persisted fingerprint after removing the standard mode option', async () => {
    const result = await buildFileTranslationResumeFingerprint({
      input: { projectId: 1, inputPath: 'input.xlsx', outputPath: 'out.xlsx' },
      project: {
        id: 1,
        srcLang: 'en',
        tgtLang: 'fr',
        projectType: 'translation',
        aiPrompt: 'Keep it short.',
      } as never,
      options: { dbPath: ':memory:' },
      mtModule: {
        resolvePromptConfig: async () => ({
          provider: {
            id: 'p',
            kind: 'configured',
            protocol: 'chat-completions',
            baseUrl: 'https://example.test',
          },
          model: 'm',
          reasoningEffort: 'medium',
        }),
      } as never,
      tmRepo: { getProjectMountedTMs: () => [] } as never,
      tbRepo: { getProjectMountedTermBases: () => [] } as never,
    });
    // Captured from the previous Translation implementation with identical inputs.
    expect(result).toBe('4ed6830a13e91039b6c03a60d5da985dc9b97e1ae3fb702eb0f33008a748a103');
  });
});
