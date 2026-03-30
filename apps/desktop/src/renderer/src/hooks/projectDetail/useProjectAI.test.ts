import { describe, expect, it, vi } from 'vitest';

vi.mock('../../services/apiClient', () => ({
  apiClient: {},
}));
import {
  buildAITestMeta,
  deriveProjectAIFlags,
  normalizeProjectAIModel,
  upsertTrackedJobFromProgress,
  upsertTrackedJobOnStart,
} from './useProjectAI';

describe('useProjectAI behavior helpers', () => {
  it('derives prompt dirty state with trim-aware comparison', () => {
    const clean = deriveProjectAIFlags({
      promptDraft: '  Keep style  ',
      savedPromptValue: 'Keep style',
      modelDraft: 'builtin:openai:gpt-5.4-mini',
      savedModelValue: 'builtin:openai:gpt-5.4-mini',
      testMeta: null,
      testUserMessage: null,
      testPromptUsed: null,
      testRawResponse: null,
    });
    expect(clean.hasUnsavedPromptChanges).toBe(false);

    const dirty = deriveProjectAIFlags({
      promptDraft: 'Keep style updated',
      savedPromptValue: 'Keep style',
      modelDraft: 'builtin:openai:gpt-5.4-mini',
      savedModelValue: 'builtin:openai:gpt-5.4-mini',
      testMeta: null,
      testUserMessage: null,
      testPromptUsed: null,
      testRawResponse: null,
    });
    expect(dirty.hasUnsavedPromptChanges).toBe(true);
  });

  it('marks test details correctly', () => {
    const flags = deriveProjectAIFlags({
      promptDraft: 'prompt',
      savedPromptValue: 'prompt',
      modelDraft: 'builtin:openai:gpt-5.4-mini',
      savedModelValue: 'builtin:openai:gpt-5.4-mini',
      testMeta: null,
      testUserMessage: 'message',
      testPromptUsed: null,
      testRawResponse: null,
    });

    expect(flags.hasUnsavedPromptChanges).toBe(false);
    expect(flags.hasTestDetails).toBe(true);
  });

  it('marks settings as dirty when model changes only', () => {
    const flags = deriveProjectAIFlags({
      promptDraft: 'prompt',
      savedPromptValue: 'prompt',
      modelDraft: 'builtin:openai:gpt-5',
      savedModelValue: 'builtin:openai:gpt-5.4-mini',
      testMeta: null,
      testUserMessage: null,
      testPromptUsed: null,
      testRawResponse: null,
    });

    expect(flags.hasUnsavedPromptChanges).toBe(true);
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

  it('normalizes legacy project ai values and preserves custom provider ids', () => {
    expect(normalizeProjectAIModel('gpt-5-mini')).toBe('builtin:openai:gpt-5-mini');
    expect(normalizeProjectAIModel('custom:provider:demo')).toBe('custom:provider:demo');
    expect(normalizeProjectAIModel(null)).toBe('builtin:openai:gpt-5.4-mini');
  });

  it('upserts unknown job progress with fallback file id', () => {
    const merged = upsertTrackedJobFromProgress({
      jobId: 'job-new',
      progress: 100,
      status: 'completed',
      message: 'Done',
    });

    expect(merged).toEqual({
      jobId: 'job-new',
      fileId: -1,
      progress: 100,
      status: 'completed',
      message: 'Done',
    });
  });

  it('keeps terminal status when start arrives after completion', () => {
    const existing = {
      jobId: 'job-race',
      fileId: -1,
      progress: 100,
      status: 'completed' as const,
      message: 'Already done',
    };

    const merged = upsertTrackedJobOnStart('job-race', 42, existing);
    expect(merged).toEqual({
      jobId: 'job-race',
      fileId: 42,
      progress: 100,
      status: 'completed',
      message: 'Already done',
    });
  });
});
