import { randomUUID } from 'node:crypto';
import { DEFAULT_SOURCE_TERMINOLOGY_SELECTION_PROMPT } from '@cat/core/project';
import type { SettingsRepository } from './ports';

const SOURCE_TERMINOLOGY_PROMPT_CATALOG_KEY = 'source_terminology_selection_prompts_v2';
const LEGACY_SOURCE_TERMINOLOGY_PROMPT_KEY = 'source_terminology_selection_prompt_v1';
const MAX_PROMPT_ID_ATTEMPTS = 8;

export const DEFAULT_SOURCE_TERMINOLOGY_PROMPT_ID = 'builtin:default';
export const SOURCE_TERMINOLOGY_SELECTION_PROMPT_MAX_CHARS = 12000;
export const SOURCE_TERMINOLOGY_PROMPT_NAME_MAX_CHARS = 80;

export interface SourceTerminologyPromptPreset {
  id: string;
  name: string;
  prompt: string;
  isBuiltin: boolean;
}

export interface SourceTerminologyPromptSettingsSnapshot {
  prompt: string;
  activePromptId: string;
  prompts: SourceTerminologyPromptPreset[];
  maxChars: number;
  maxNameChars: number;
  loadWarning?: string;
}

export type SourceTerminologyPromptSettingsMutation =
  | { action: 'create'; name: string; prompt: string }
  | { action: 'update'; promptId: string; name: string; prompt: string }
  | { action: 'delete'; promptId: string }
  | { action: 'activate'; promptId: string };

interface StoredPromptPreset {
  id: string;
  name: string;
  prompt: string;
}

interface StoredPromptCatalog {
  version: 1;
  activePromptId: string;
  prompts: StoredPromptPreset[];
}

interface PromptCatalogState {
  activePromptId: string;
  prompts: StoredPromptPreset[];
}

interface PromptCatalogReadResult {
  state: PromptCatalogState;
  loadWarning?: string;
}

export class SourceTerminologyPromptSettingsService {
  constructor(
    private readonly settingsRepo: Pick<SettingsRepository, 'getSetting' | 'setSetting'>,
    private readonly createId: () => string = randomUUID,
  ) {}

  public getSettings(): SourceTerminologyPromptSettingsSnapshot {
    const catalog = this.readCatalog();
    return this.toSnapshot(catalog.state, catalog.loadWarning);
  }

  public applyMutation(
    mutation: SourceTerminologyPromptSettingsMutation,
  ): SourceTerminologyPromptSettingsSnapshot {
    const { state } = this.readCatalog();

    switch (mutation.action) {
      case 'create': {
        const name = this.normalizeName(mutation.name);
        const prompt = this.normalizePrompt(mutation.prompt);
        this.assertNameAvailable(state.prompts, name);
        const id = this.createUniqueId(state.prompts);
        state.prompts.push({ id, name, prompt });
        state.activePromptId = id;
        break;
      }
      case 'update': {
        this.assertMutablePromptId(mutation.promptId);
        const existing = state.prompts.find((prompt) => prompt.id === mutation.promptId);
        if (!existing) throw new Error('Term extraction prompt not found.');
        const name = this.normalizeName(mutation.name);
        const prompt = this.normalizePrompt(mutation.prompt);
        this.assertNameAvailable(state.prompts, name, mutation.promptId);
        existing.name = name;
        existing.prompt = prompt;
        break;
      }
      case 'delete': {
        this.assertMutablePromptId(mutation.promptId);
        const index = state.prompts.findIndex((prompt) => prompt.id === mutation.promptId);
        if (index < 0) throw new Error('Term extraction prompt not found.');
        state.prompts.splice(index, 1);
        if (state.activePromptId === mutation.promptId) {
          state.activePromptId = DEFAULT_SOURCE_TERMINOLOGY_PROMPT_ID;
        }
        break;
      }
      case 'activate': {
        if (
          mutation.promptId !== DEFAULT_SOURCE_TERMINOLOGY_PROMPT_ID &&
          !state.prompts.some((prompt) => prompt.id === mutation.promptId)
        ) {
          throw new Error('Term extraction prompt not found.');
        }
        state.activePromptId = mutation.promptId;
        break;
      }
      default:
        throw new Error('Unsupported term extraction prompt action.');
    }

    this.persistCatalog(state);
    return this.toSnapshot(state);
  }

  private readCatalog(): PromptCatalogReadResult {
    const storedCatalog = this.settingsRepo.getSetting(SOURCE_TERMINOLOGY_PROMPT_CATALOG_KEY);
    if (storedCatalog !== undefined) {
      return this.parseStoredCatalog(storedCatalog);
    }

    const legacyPrompt = this.settingsRepo.getSetting(LEGACY_SOURCE_TERMINOLOGY_PROMPT_KEY)?.trim();
    if (
      this.isValidPrompt(legacyPrompt) &&
      legacyPrompt !== DEFAULT_SOURCE_TERMINOLOGY_SELECTION_PROMPT
    ) {
      return {
        state: {
          activePromptId: 'legacy:custom',
          prompts: [{ id: 'legacy:custom', name: 'Custom Prompt', prompt: legacyPrompt }],
        },
      };
    }

    return {
      state: { activePromptId: DEFAULT_SOURCE_TERMINOLOGY_PROMPT_ID, prompts: [] },
    };
  }

  private parseStoredCatalog(raw: string): PromptCatalogReadResult {
    try {
      const value = JSON.parse(raw) as Partial<StoredPromptCatalog>;
      if (value.version !== 1 || !Array.isArray(value.prompts)) {
        return this.invalidCatalogResult();
      }

      const prompts: StoredPromptPreset[] = [];
      const ids = new Set<string>();
      const names = new Set<string>(['default']);
      let skippedPromptCount = 0;
      for (const candidate of value.prompts) {
        if (!candidate || typeof candidate !== 'object') {
          skippedPromptCount += 1;
          continue;
        }
        const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
        const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
        const prompt = typeof candidate.prompt === 'string' ? candidate.prompt.trim() : '';
        const normalizedName = name.toLowerCase();
        if (
          !id ||
          id === DEFAULT_SOURCE_TERMINOLOGY_PROMPT_ID ||
          ids.has(id) ||
          !name ||
          name.length > SOURCE_TERMINOLOGY_PROMPT_NAME_MAX_CHARS ||
          names.has(normalizedName) ||
          !this.isValidPrompt(prompt)
        ) {
          skippedPromptCount += 1;
          continue;
        }
        ids.add(id);
        names.add(normalizedName);
        prompts.push({ id, name, prompt });
      }

      const requestedActiveId =
        typeof value.activePromptId === 'string' ? value.activePromptId : '';
      const activePromptId =
        requestedActiveId === DEFAULT_SOURCE_TERMINOLOGY_PROMPT_ID || ids.has(requestedActiveId)
          ? requestedActiveId
          : DEFAULT_SOURCE_TERMINOLOGY_PROMPT_ID;
      const warnings: string[] = [];
      if (skippedPromptCount > 0) {
        warnings.push(
          `${skippedPromptCount} invalid saved prompt${skippedPromptCount === 1 ? ' was' : 's were'} not loaded.`,
        );
      }
      if (requestedActiveId && activePromptId !== requestedActiveId) {
        warnings.push('The previously active prompt was unavailable, so Default is now active.');
      }
      return {
        state: { activePromptId, prompts },
        loadWarning: warnings.length > 0 ? warnings.join(' ') : undefined,
      };
    } catch {
      return this.invalidCatalogResult();
    }
  }

  private invalidCatalogResult(): PromptCatalogReadResult {
    return {
      state: { activePromptId: DEFAULT_SOURCE_TERMINOLOGY_PROMPT_ID, prompts: [] },
      loadWarning:
        'The saved term extraction prompt library could not be read. Default is active; the next saved change will replace the invalid library.',
    };
  }

  private persistCatalog(state: PromptCatalogState): void {
    const catalog: StoredPromptCatalog = {
      version: 1,
      activePromptId: state.activePromptId,
      prompts: state.prompts,
    };
    this.settingsRepo.setSetting(SOURCE_TERMINOLOGY_PROMPT_CATALOG_KEY, JSON.stringify(catalog));
    this.settingsRepo.setSetting(LEGACY_SOURCE_TERMINOLOGY_PROMPT_KEY, null);
  }

  private toSnapshot(
    state: PromptCatalogState,
    loadWarning?: string,
  ): SourceTerminologyPromptSettingsSnapshot {
    const builtinPrompt: SourceTerminologyPromptPreset = {
      id: DEFAULT_SOURCE_TERMINOLOGY_PROMPT_ID,
      name: 'Default',
      prompt: DEFAULT_SOURCE_TERMINOLOGY_SELECTION_PROMPT,
      isBuiltin: true,
    };
    const customPrompts = [...state.prompts]
      .sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }),
      )
      .map((prompt) => ({ ...prompt, isBuiltin: false }));
    const prompts = [builtinPrompt, ...customPrompts];
    const activePrompt =
      prompts.find((prompt) => prompt.id === state.activePromptId) ?? builtinPrompt;

    return {
      prompt: activePrompt.prompt,
      activePromptId: activePrompt.id,
      prompts,
      maxChars: SOURCE_TERMINOLOGY_SELECTION_PROMPT_MAX_CHARS,
      maxNameChars: SOURCE_TERMINOLOGY_PROMPT_NAME_MAX_CHARS,
      loadWarning,
    };
  }

  private normalizeName(name: string): string {
    const normalized = name.trim();
    if (!normalized) throw new Error('Prompt name cannot be empty.');
    if (normalized.length > SOURCE_TERMINOLOGY_PROMPT_NAME_MAX_CHARS) {
      throw new Error(
        `Prompt name cannot exceed ${SOURCE_TERMINOLOGY_PROMPT_NAME_MAX_CHARS} characters.`,
      );
    }
    return normalized;
  }

  private normalizePrompt(prompt: string): string {
    const normalized = prompt.trim();
    if (!normalized) throw new Error('Term extraction prompt cannot be empty.');
    if (normalized.length > SOURCE_TERMINOLOGY_SELECTION_PROMPT_MAX_CHARS) {
      throw new Error(
        `Term extraction prompt cannot exceed ${SOURCE_TERMINOLOGY_SELECTION_PROMPT_MAX_CHARS} characters.`,
      );
    }
    return normalized;
  }

  private assertNameAvailable(
    prompts: StoredPromptPreset[],
    name: string,
    excludeId?: string,
  ): void {
    const normalizedName = name.toLowerCase();
    if (
      normalizedName === 'default' ||
      prompts.some(
        (prompt) => prompt.id !== excludeId && prompt.name.toLowerCase() === normalizedName,
      )
    ) {
      throw new Error(`A prompt named "${name}" already exists.`);
    }
  }

  private createUniqueId(prompts: StoredPromptPreset[]): string {
    for (let attempt = 0; attempt < MAX_PROMPT_ID_ATTEMPTS; attempt += 1) {
      const id = this.createId();
      if (
        id &&
        id !== DEFAULT_SOURCE_TERMINOLOGY_PROMPT_ID &&
        !prompts.some((prompt) => prompt.id === id)
      ) {
        return id;
      }
    }
    throw new Error('Unable to create a unique term extraction prompt id.');
  }

  private assertMutablePromptId(promptId: string): void {
    if (promptId === DEFAULT_SOURCE_TERMINOLOGY_PROMPT_ID) {
      throw new Error('The default term extraction prompt cannot be changed or deleted.');
    }
  }

  private isValidPrompt(prompt: string | undefined): prompt is string {
    return Boolean(prompt && prompt.length <= SOURCE_TERMINOLOGY_SELECTION_PROMPT_MAX_CHARS);
  }
}
