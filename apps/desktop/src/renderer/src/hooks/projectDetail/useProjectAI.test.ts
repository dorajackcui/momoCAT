import { describe, expect, it, vi } from 'vitest';
import type { AIProviderSummary } from '../../../../shared/ipc';

vi.mock('../../services/apiClient', () => ({
  apiClient: {},
}));
import {
  buildAITestMeta,
  buildProjectAISystemPromptPreview,
  deriveProjectAIFlags,
  normalizeProjectAIModel,
  upsertTrackedJobFromProgress,
  upsertTrackedJobOnStart,
} from './useProjectAI';
import {
  deriveProjectAIProviderDraftsAfterProviderOptionsChange,
  deriveProjectAIProviderAvailability,
  getProjectAIProviderActionBlockMessage,
  normalizeProjectAIProviderPersistenceValue,
  normalizeProjectAIProviderSelection,
} from './ai/aiSettingsHelpers';

const configuredProvider: AIProviderSummary = {
  id: 'provider:gpt-demo',
  name: 'OpenAI / gpt-demo',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-demo',
  protocol: 'chat-completions',
  kind: 'configured',
  connectionId: 'connection:openai',
  connectionName: 'OpenAI',
  apiKeyLast4: '1234',
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
};

describe('useProjectAI behavior helpers', () => {
  it('derives prompt dirty state with trim-aware comparison', () => {
    const clean = deriveProjectAIFlags({
      promptDraft: '  Keep style  ',
      savedPromptValue: 'Keep style',
      modelDraft: 'provider:gpt-demo',
      savedModelValue: 'provider:gpt-demo',
      testMeta: null,
      testUserPrompt: null,
      testSystemPrompt: null,
      testRawResponse: null,
    });
    expect(clean.hasUnsavedPromptChanges).toBe(false);

    const dirty = deriveProjectAIFlags({
      promptDraft: 'Keep style updated',
      savedPromptValue: 'Keep style',
      modelDraft: 'provider:gpt-demo',
      savedModelValue: 'provider:gpt-demo',
      testMeta: null,
      testUserPrompt: null,
      testSystemPrompt: null,
      testRawResponse: null,
    });
    expect(dirty.hasUnsavedPromptChanges).toBe(true);
  });

  it('marks test details correctly', () => {
    const flags = deriveProjectAIFlags({
      promptDraft: 'prompt',
      savedPromptValue: 'prompt',
      modelDraft: 'provider:gpt-demo',
      savedModelValue: 'provider:gpt-demo',
      testMeta: null,
      testUserPrompt: 'message',
      testSystemPrompt: null,
      testRawResponse: null,
    });

    expect(flags.hasUnsavedPromptChanges).toBe(false);
    expect(flags.hasTestDetails).toBe(true);
  });

  it('marks settings as dirty when model changes only', () => {
    const flags = deriveProjectAIFlags({
      promptDraft: 'prompt',
      savedPromptValue: 'prompt',
      modelDraft: 'provider:gpt-demo-mini',
      savedModelValue: 'provider:gpt-demo',
      testMeta: null,
      testUserPrompt: null,
      testSystemPrompt: null,
      testRawResponse: null,
    });

    expect(flags.hasUnsavedPromptChanges).toBe(true);
  });

  it('builds effective system prompt previews from the current draft', () => {
    const translationPreview = buildProjectAISystemPromptPreview({
      projectType: 'translation',
      srcLang: 'en',
      tgtLang: 'zh',
      promptDraft: ' Use concise style. ',
    });
    const customPreview = buildProjectAISystemPromptPreview({
      projectType: 'custom',
      srcLang: 'en',
      tgtLang: 'zh',
      promptDraft: '',
    });

    expect(translationPreview).toContain('Use concise style.');
    expect(translationPreview).toContain('From en to zh. Output in zh ONLY.');
    expect(customPreview).toContain('You are a precise text processing assistant.');
  });

  it('builds deterministic AI test meta text', () => {
    const meta = buildAITestMeta({
      status: 200,
      requestId: 'req_123',
      model: 'gpt-5-mini',
      endpoint: '/v1/chat/completions',
      ok: false,
    });

    expect(meta).toBe(
      'status: 200 • requestId: req_123 • model: gpt-5-mini • endpoint: /v1/chat/completions • ok: false',
    );
  });

  it('normalizes project ai provider ids as plain configured ids', () => {
    expect(normalizeProjectAIModel(' provider:gpt-demo ')).toBe('provider:gpt-demo');
    expect(normalizeProjectAIModel(null)).toBe('');
  });

  it('preserves unavailable project provider ids instead of selecting a builtin default', () => {
    expect(normalizeProjectAIProviderSelection('provider:missing', [])).toBe('provider:missing');
    expect(normalizeProjectAIProviderSelection(null, [])).toBe('');
    expect(normalizeProjectAIProviderSelection(null, [configuredProvider])).toBe(
      'provider:gpt-demo',
    );
  });

  it('derives setup and unavailable provider warnings', () => {
    expect(deriveProjectAIProviderAvailability('', [])).toEqual({
      providerSetupRequired: true,
      providerUnavailable: false,
      providerWarning: 'Add an AI provider in Settings before running AI actions.',
    });
    expect(
      deriveProjectAIProviderAvailability('provider:missing', [configuredProvider]),
    ).toEqual({
      providerSetupRequired: false,
      providerUnavailable: true,
      providerWarning:
        'The saved AI provider is no longer available. Choose a configured provider and save.',
    });
    expect(
      deriveProjectAIProviderAvailability('provider:gpt-demo', [configuredProvider]),
    ).toEqual({
      providerSetupRequired: false,
      providerUnavailable: false,
      providerWarning: null,
    });
  });

  it('normalizes empty project provider ids to null for persistence', () => {
    expect(normalizeProjectAIProviderPersistenceValue('')).toBeNull();
    expect(normalizeProjectAIProviderPersistenceValue(' provider:gpt-demo ')).toBe(
      'provider:gpt-demo',
    );
  });

  it('adopts the first provider after reload only when the project and drafts are empty', () => {
    expect(
      deriveProjectAIProviderDraftsAfterProviderOptionsChange({
        projectAIModel: null,
        modelDraft: '',
        savedModelValue: '',
        providerOptions: [configuredProvider],
      }),
    ).toEqual({
      modelDraft: 'provider:gpt-demo',
      savedModelValue: 'provider:gpt-demo',
    });

    expect(
      deriveProjectAIProviderDraftsAfterProviderOptionsChange({
        projectAIModel: null,
        modelDraft: 'provider:user-choice',
        savedModelValue: '',
        providerOptions: [configuredProvider],
      }),
    ).toEqual({
      modelDraft: 'provider:user-choice',
      savedModelValue: '',
    });

    expect(
      deriveProjectAIProviderDraftsAfterProviderOptionsChange({
        projectAIModel: 'provider:missing',
        modelDraft: 'provider:missing',
        savedModelValue: 'provider:missing',
        providerOptions: [configuredProvider],
      }),
    ).toEqual({
      modelDraft: 'provider:missing',
      savedModelValue: 'provider:missing',
    });
  });

  it('returns an action block message only when provider setup is required or unavailable', () => {
    expect(
      getProjectAIProviderActionBlockMessage({
        providerSetupRequired: true,
        providerUnavailable: false,
        providerWarning: 'Add an AI provider in Settings before running AI actions.',
      }),
    ).toBe('Add an AI provider in Settings before running AI actions.');

    expect(
      getProjectAIProviderActionBlockMessage({
        providerSetupRequired: false,
        providerUnavailable: true,
        providerWarning:
          'The saved AI provider is no longer available. Choose a configured provider and save.',
      }),
    ).toBe('The saved AI provider is no longer available. Choose a configured provider and save.');

    expect(
      getProjectAIProviderActionBlockMessage({
        providerSetupRequired: false,
        providerUnavailable: false,
        providerWarning: null,
      }),
    ).toBeNull();
  });

  it('upserts unknown job progress with fallback file id', () => {
    const merged = upsertTrackedJobFromProgress({
      jobId: 'job-new',
      progress: 100,
      status: 'completed',
      message: 'Done',
    });

    expect(merged).toEqual({
      kind: 'ai-translate-file',
      jobId: 'job-new',
      fileId: -1,
      progress: 100,
      status: 'completed',
      message: 'Done',
    });
  });

  it('keeps terminal status when start arrives after completion', () => {
    const existing = {
      kind: 'ai-translate-file' as const,
      jobId: 'job-race',
      fileId: -1,
      progress: 100,
      status: 'completed' as const,
      message: 'Already done',
    };

    const merged = upsertTrackedJobOnStart('job-race', 42, existing);
    expect(merged).toEqual({
      kind: 'ai-translate-file',
      jobId: 'job-race',
      fileId: 42,
      progress: 100,
      status: 'completed',
      message: 'Already done',
    });
  });
});
