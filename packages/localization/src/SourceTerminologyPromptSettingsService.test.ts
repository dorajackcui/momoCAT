import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SOURCE_TERMINOLOGY_SELECTION_PROMPT } from '@cat/core/project';
import type { SettingsRepository } from './ports';
import {
  DEFAULT_SOURCE_TERMINOLOGY_PROMPT_ID,
  SOURCE_TERMINOLOGY_PROMPT_NAME_MAX_CHARS,
  SOURCE_TERMINOLOGY_SELECTION_PROMPT_MAX_CHARS,
  SourceTerminologyPromptSettingsService,
} from './SourceTerminologyPromptSettingsService';

function createService(seed?: Record<string, string>, createId?: () => string) {
  const store = new Map(Object.entries(seed ?? {}));
  const ids = ['prompt-1', 'prompt-2', 'prompt-3'];
  const settingsRepo = {
    getSetting: vi.fn((key: string) => store.get(key)),
    setSetting: vi.fn((key: string, value: string | null) => {
      if (value === null) store.delete(key);
      else store.set(key, value);
    }),
  } satisfies Pick<SettingsRepository, 'getSetting' | 'setSetting'>;

  return {
    service: new SourceTerminologyPromptSettingsService(
      settingsRepo,
      createId ?? (() => ids.shift() ?? 'next'),
    ),
    settingsRepo,
    store,
  };
}

describe('SourceTerminologyPromptSettingsService', () => {
  it('exposes the current extraction policy as an immutable built-in prompt', () => {
    const { service } = createService();

    expect(service.getSettings()).toEqual({
      prompt: DEFAULT_SOURCE_TERMINOLOGY_SELECTION_PROMPT,
      activePromptId: DEFAULT_SOURCE_TERMINOLOGY_PROMPT_ID,
      prompts: [
        {
          id: DEFAULT_SOURCE_TERMINOLOGY_PROMPT_ID,
          name: 'Default',
          prompt: DEFAULT_SOURCE_TERMINOLOGY_SELECTION_PROMPT,
          isBuiltin: true,
        },
      ],
      maxChars: SOURCE_TERMINOLOGY_SELECTION_PROMPT_MAX_CHARS,
      maxNameChars: SOURCE_TERMINOLOGY_PROMPT_NAME_MAX_CHARS,
    });
  });

  it('creates, updates, activates, and deletes named prompts', () => {
    const { service } = createService();

    const first = service.applyMutation({
      action: 'create',
      name: '  Named locations  ',
      prompt: '  Prefer named locations.  ',
    });
    expect(first).toMatchObject({
      activePromptId: 'prompt-1',
      prompt: 'Prefer named locations.',
    });

    service.applyMutation({
      action: 'create',
      name: 'UI concepts',
      prompt: 'Prefer named UI concepts.',
    });
    const updated = service.applyMutation({
      action: 'update',
      promptId: 'prompt-1',
      name: 'Named places',
      prompt: 'Prefer named places and regions.',
    });
    expect(updated.prompts.map((prompt) => prompt.name)).toEqual([
      'Default',
      'Named places',
      'UI concepts',
    ]);
    expect(service.applyMutation({ action: 'delete', promptId: 'prompt-2' })).toMatchObject({
      activePromptId: DEFAULT_SOURCE_TERMINOLOGY_PROMPT_ID,
    });

    expect(service.applyMutation({ action: 'activate', promptId: 'prompt-1' })).toMatchObject({
      prompt: 'Prefer named places and regions.',
      activePromptId: 'prompt-1',
    });
    expect(
      service.applyMutation({
        action: 'activate',
        promptId: DEFAULT_SOURCE_TERMINOLOGY_PROMPT_ID,
      }),
    ).toMatchObject({
      prompt: DEFAULT_SOURCE_TERMINOLOGY_SELECTION_PROMPT,
      activePromptId: DEFAULT_SOURCE_TERMINOLOGY_PROMPT_ID,
    });
  });

  it('enforces names, content, duplicates, built-in protection, and missing ids', () => {
    const { service } = createService();
    service.applyMutation({ action: 'create', name: 'Locations', prompt: 'Prefer locations.' });

    expect(() =>
      service.applyMutation({ action: 'create', name: 'locations', prompt: 'Different.' }),
    ).toThrow('already exists');
    expect(() =>
      service.applyMutation({ action: 'create', name: ' ', prompt: 'Different.' }),
    ).toThrow('Prompt name cannot be empty.');
    expect(() => service.applyMutation({ action: 'create', name: 'Empty', prompt: '   ' })).toThrow(
      'Term extraction prompt cannot be empty.',
    );
    expect(() =>
      service.applyMutation({
        action: 'create',
        name: 'Too long',
        prompt: 'x'.repeat(SOURCE_TERMINOLOGY_SELECTION_PROMPT_MAX_CHARS + 1),
      }),
    ).toThrow(`cannot exceed ${SOURCE_TERMINOLOGY_SELECTION_PROMPT_MAX_CHARS} characters`);
    expect(() =>
      service.applyMutation({ action: 'delete', promptId: DEFAULT_SOURCE_TERMINOLOGY_PROMPT_ID }),
    ).toThrow('cannot be changed or deleted');
    expect(() => service.applyMutation({ action: 'activate', promptId: 'missing' })).toThrow(
      'not found',
    );
  });

  it('fails instead of retrying forever when unique prompt ids cannot be generated', () => {
    const createId = vi.fn(() => 'repeated-id');
    const { service } = createService(undefined, createId);
    service.applyMutation({ action: 'create', name: 'First', prompt: 'Prefer first terms.' });

    expect(() =>
      service.applyMutation({ action: 'create', name: 'Second', prompt: 'Prefer second terms.' }),
    ).toThrow('Unable to create a unique term extraction prompt id.');
    expect(createId).toHaveBeenCalledTimes(9);
  });

  it('loads the legacy single prompt and migrates it on the first mutation', () => {
    const { service, store } = createService({
      source_terminology_selection_prompt_v1: '  Prefer named UI concepts.  ',
    });

    expect(service.getSettings()).toMatchObject({
      activePromptId: 'legacy:custom',
      prompt: 'Prefer named UI concepts.',
    });
    expect(service.getSettings().prompts[1]).toMatchObject({
      id: 'legacy:custom',
      name: 'Custom Prompt',
    });

    service.applyMutation({
      action: 'activate',
      promptId: DEFAULT_SOURCE_TERMINOLOGY_PROMPT_ID,
    });
    expect(store.has('source_terminology_selection_prompt_v1')).toBe(false);
    expect(JSON.parse(store.get('source_terminology_selection_prompts_v2') ?? '{}')).toMatchObject({
      version: 1,
      activePromptId: DEFAULT_SOURCE_TERMINOLOGY_PROMPT_ID,
      prompts: [{ id: 'legacy:custom', name: 'Custom Prompt' }],
    });
  });

  it('reports malformed catalog entries while falling back to the default prompt', () => {
    const { service } = createService({
      source_terminology_selection_prompts_v2: JSON.stringify({
        version: 1,
        activePromptId: 'invalid',
        prompts: [
          { id: '', name: 'Broken', prompt: 'Content' },
          { id: 'too-long', name: 'Valid', prompt: 'x'.repeat(12001) },
        ],
      }),
    });

    const settings = service.getSettings();
    expect(settings).toMatchObject({
      activePromptId: DEFAULT_SOURCE_TERMINOLOGY_PROMPT_ID,
      prompt: DEFAULT_SOURCE_TERMINOLOGY_SELECTION_PROMPT,
    });
    expect(settings.loadWarning).toContain('2 invalid saved prompts were not loaded.');
    expect(settings.loadWarning).toContain('previously active prompt was unavailable');
  });

  it('reports an unreadable catalog instead of silently presenting an empty library', () => {
    const { service } = createService({
      source_terminology_selection_prompts_v2: '{not-json',
    });

    expect(service.getSettings().loadWarning).toContain('could not be read');
  });
});
