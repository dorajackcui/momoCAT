import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  SourceTerminologyPromptPreset,
  SourceTerminologyPromptSettings,
  SourceTerminologyPromptSettingsInput,
} from '../../../../shared/ipc';
import { apiClient } from '../../services/apiClient';
import { feedbackService } from '../../services/feedbackService';

export function TermExtractionPromptTab() {
  const [settings, setSettings] = useState<SourceTerminologyPromptSettings | null>(null);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draft, setDraft] = useState('');
  const [createSeed, setCreateSeed] = useState('');
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const selectPrompt = useCallback(
    (nextSettings: SourceTerminologyPromptSettings, promptId = nextSettings.activePromptId) => {
      const prompt =
        nextSettings.prompts.find((candidate) => candidate.id === promptId) ??
        nextSettings.prompts.find((candidate) => candidate.id === nextSettings.activePromptId);
      setSettings(nextSettings);
      setSelectedPromptId(prompt?.id ?? null);
      setDraftName(prompt?.name ?? '');
      setDraft(prompt?.prompt ?? '');
      setCreateSeed('');
      setCreating(false);
    },
    [],
  );

  useEffect(() => {
    let active = true;
    void apiClient
      .getSourceTerminologyPromptSettings()
      .then((loaded) => {
        if (!active) return;
        selectPrompt(loaded);
        if (loaded.loadWarning) {
          setStatus(`Prompt library warning: ${loaded.loadWarning}`);
        }
      })
      .catch((error) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`Failed to load term extraction prompts: ${message}`);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectPrompt]);

  const selectedPrompt = useMemo(
    () => settings?.prompts.find((prompt) => prompt.id === selectedPromptId) ?? null,
    [selectedPromptId, settings],
  );
  const normalizedName = draftName.trim();
  const normalizedDraft = draft.trim();
  const dirty = creating
    ? normalizedName.length > 0 || normalizedDraft !== createSeed
    : selectedPrompt !== null &&
      (normalizedName !== selectedPrompt.name || normalizedDraft !== selectedPrompt.prompt);
  const valid =
    settings !== null &&
    normalizedName.length > 0 &&
    normalizedName.length <= settings.maxNameChars &&
    normalizedDraft.length > 0 &&
    normalizedDraft.length <= settings.maxChars;

  const confirmDiscard = async (nextName: string): Promise<boolean> => {
    if (!dirty) return true;
    return feedbackService.confirm(`Discard unsaved prompt changes and open "${nextName}"?`);
  };

  const mutate = async (
    input: SourceTerminologyPromptSettingsInput,
    successMessage: string,
    preferredPromptId?: string,
  ): Promise<SourceTerminologyPromptSettings | null> => {
    setSaving(true);
    setStatus(null);
    try {
      const saved = await apiClient.setSourceTerminologyPromptSettings(input);
      selectPrompt(saved, preferredPromptId ?? saved.activePromptId);
      setStatus(successMessage);
      return saved;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed to update term extraction prompts: ${message}`);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSelect = async (prompt: SourceTerminologyPromptPreset) => {
    if (!(await confirmDiscard(prompt.name)) || !settings) return;
    selectPrompt(settings, prompt.id);
    setStatus(null);
  };

  const handleActivate = async (prompt: SourceTerminologyPromptPreset) => {
    if (!(await confirmDiscard(prompt.name))) return;
    await mutate(
      { action: 'activate', promptId: prompt.id },
      `"${prompt.name}" is now used for term extraction.`,
      prompt.id,
    );
  };

  const handleCreate = async () => {
    if (!settings || !(await confirmDiscard('a new prompt'))) return;
    const seed = selectedPrompt?.prompt ?? settings.prompt;
    setCreating(true);
    setSelectedPromptId(null);
    setDraftName('');
    setDraft(seed);
    setCreateSeed(seed);
    setStatus(null);
  };

  const handleSave = async () => {
    if (!settings || !valid) return;
    if (creating) {
      await mutate(
        { action: 'create', name: normalizedName, prompt: normalizedDraft },
        `"${normalizedName}" was saved and is now in use.`,
      );
      return;
    }
    if (!selectedPrompt || selectedPrompt.isBuiltin) return;
    await mutate(
      {
        action: 'update',
        promptId: selectedPrompt.id,
        name: normalizedName,
        prompt: normalizedDraft,
      },
      `"${normalizedName}" was updated.`,
      selectedPrompt.id,
    );
  };

  const handleDelete = async (prompt: SourceTerminologyPromptPreset) => {
    const confirmed = await feedbackService.confirm(
      dirty
        ? `Discard unsaved prompt changes and delete saved prompt "${prompt.name}"?`
        : `Delete saved prompt "${prompt.name}"?`,
    );
    if (!confirmed) return;
    await mutate({ action: 'delete', promptId: prompt.id }, `"${prompt.name}" was deleted.`);
  };

  const cancelEditing = () => {
    if (settings) selectPrompt(settings);
    setStatus(null);
  };

  return (
    <section className="space-y-4">
      <div className="surface-card p-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-text">Term Extraction Prompts</h3>
          <p className="mt-1 text-xs text-text-muted">
            Save multiple selection policies and choose which one future extraction jobs use.
          </p>
          <p className="mt-1 text-[11px] text-text-muted">
            Source text, historical terms, injection protection, and strict JSON formatting remain
            application-controlled.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={loading || saving || settings === null || creating}
            className="btn-primary"
          >
            New Prompt
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.75fr)_minmax(0,1.5fr)]">
        <div className="surface-card p-3 space-y-2">
          <div className="px-1 text-[11px] font-bold uppercase tracking-wider text-text-faint">
            Prompt Library
          </div>
          {settings?.prompts.map((prompt) => {
            const active = prompt.id === settings.activePromptId;
            const selected = prompt.id === selectedPromptId;
            return (
              <div
                key={prompt.id}
                className={`surface-subtle rounded-xl p-3 space-y-2 ${
                  selected ? 'ring-1 ring-brand' : ''
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-text">{prompt.name}</span>
                    {active && (
                      <span className="text-[10px] uppercase tracking-wider text-success">
                        In use
                      </span>
                    )}
                    {prompt.isBuiltin && (
                      <span className="text-[10px] uppercase tracking-wider text-text-faint">
                        Built-in
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-[11px] text-text-muted">{prompt.prompt}</p>
                </div>
                <div className="flex flex-wrap justify-end gap-1">
                  {!active && (
                    <button
                      type="button"
                      aria-label={`Use ${prompt.name}`}
                      onClick={() => void handleActivate(prompt)}
                      disabled={saving}
                      className="btn-secondary !px-2 !py-1 text-xs"
                    >
                      Use
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`${prompt.isBuiltin ? 'View' : 'Edit'} ${prompt.name}`}
                    onClick={() => void handleSelect(prompt)}
                    disabled={saving || selected}
                    className="btn-ghost !px-2 !py-1 text-xs"
                  >
                    {prompt.isBuiltin ? 'View' : 'Edit'}
                  </button>
                  {!prompt.isBuiltin && (
                    <button
                      type="button"
                      aria-label={`Delete ${prompt.name}`}
                      onClick={() => void handleDelete(prompt)}
                      disabled={saving}
                      className="btn-ghost !px-2 !py-1 text-xs !text-danger"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {loading && <div className="px-1 text-xs text-text-muted">Loading prompts...</div>}
        </div>

        <div className="surface-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-bold text-text">
              {creating ? 'New Prompt' : selectedPrompt?.name || 'Prompt Editor'}
            </h4>
            {selectedPrompt?.isBuiltin && (
              <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-text-muted">
                Read only
              </span>
            )}
          </div>

          {(creating || (selectedPrompt && !selectedPrompt.isBuiltin)) && (
            <div>
              <label
                htmlFor="term-extraction-prompt-name"
                className="mb-1 block text-xs font-semibold text-text-muted"
              >
                Prompt Name
              </label>
              <input
                id="term-extraction-prompt-name"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                disabled={saving}
                maxLength={settings?.maxNameChars}
                className="field-input"
              />
            </div>
          )}

          <div>
            <label
              htmlFor="term-extraction-selection-prompt"
              className="mb-1 block text-xs font-semibold text-text-muted"
            >
              Selection Prompt
            </label>
            <textarea
              id="term-extraction-selection-prompt"
              aria-label="Term extraction selection prompt"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={loading || saving || settings === null}
              readOnly={selectedPrompt?.isBuiltin}
              maxLength={settings?.maxChars}
              rows={16}
              className="field-input resize-y font-mono text-xs leading-relaxed"
            />
          </div>

          <div className="flex items-center justify-between gap-3 text-[11px] text-text-muted">
            <span>{draft.length.toLocaleString()} characters</span>
            {settings && <span>Maximum {settings.maxChars.toLocaleString()}</span>}
          </div>

          {(creating || (selectedPrompt && !selectedPrompt.isBuiltin)) && (
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={cancelEditing}
                disabled={saving}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || !dirty || !valid}
                className="btn-primary"
              >
                {saving ? 'Saving...' : creating ? 'Save and Use' : 'Save Changes'}
              </button>
            </div>
          )}

          {selectedPrompt?.isBuiltin && (
            <p className="text-[11px] text-text-faint">
              The built-in prompt cannot be overwritten. Choose New Prompt to use it as a starting
              point for a custom version.
            </p>
          )}
        </div>
      </div>

      {status && <div className="status-note">{status}</div>}
    </section>
  );
}
