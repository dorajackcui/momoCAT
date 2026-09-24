import { Button, Input, Textarea } from '../ui';
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
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text">Extraction prompts</h3>
          <p className="mt-1 text-xs text-text-muted">
            Choose the prompt used for term extraction.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            type="button"
            onClick={() => void handleCreate()}
            disabled={loading || saving || settings === null || creating}
          >
            New prompt
          </Button>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(200px,0.65fr)_minmax(0,1.5fr)]">
        <div className="min-w-0 space-y-2">
          <h4 className="workspace-section-heading mb-3">Prompt library</h4>
          {settings?.prompts.map((prompt) => {
            const active = prompt.id === settings.activePromptId;
            const selected = prompt.id === selectedPromptId;
            return (
              <div
                key={prompt.id}
                className={`workspace-settings-section ${selected ? 'ring-1 ring-focus/50' : ''}`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-words text-sm font-medium text-text">{prompt.name}</span>
                    {active && <span className="text-xs text-text-muted">In use</span>}
                    {prompt.isBuiltin && <span className="text-xs text-text-muted">Built-in</span>}
                  </div>
                  <p className="mt-1 truncate text-xs text-text-muted">{prompt.prompt}</p>
                </div>
                <div className="workspace-settings-actions">
                  {!active && (
                    <Button
                      size="xs"
                      variant="secondary"
                      type="button"
                      aria-label={`Use ${prompt.name}`}
                      onClick={() => void handleActivate(prompt)}
                      disabled={saving}
                    >
                      Use
                    </Button>
                  )}
                  <Button
                    size="xs"
                    variant="ghost"
                    type="button"
                    aria-label={`${prompt.isBuiltin ? 'View' : 'Edit'} ${prompt.name}`}
                    onClick={() => void handleSelect(prompt)}
                    disabled={saving || selected}
                  >
                    {prompt.isBuiltin ? 'View' : 'Edit'}
                  </Button>
                  {!prompt.isBuiltin && (
                    <Button
                      tone="danger"
                      size="xs"
                      variant="ghost"
                      type="button"
                      aria-label={`Delete ${prompt.name}`}
                      onClick={() => void handleDelete(prompt)}
                      disabled={saving}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {loading && <div className="px-1 text-xs text-text-muted">Loading prompts...</div>}
        </div>

        <div className="workspace-settings-section min-w-0">
          <div className="workspace-section-heading flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-text">
              {creating ? 'New prompt' : selectedPrompt?.name || 'Prompt editor'}
            </h4>
            {selectedPrompt?.isBuiltin && (
              <span className="shrink-0 text-xs text-text-muted">Read only</span>
            )}
          </div>

          {(creating || (selectedPrompt && !selectedPrompt.isBuiltin)) && (
            <div>
              <label htmlFor="term-extraction-prompt-name" className="workspace-settings-label">
                Prompt name
              </label>
              <Input
                id="term-extraction-prompt-name"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                disabled={saving}
                maxLength={settings?.maxNameChars}
              />
            </div>
          )}

          <div>
            <label htmlFor="term-extraction-selection-prompt" className="workspace-settings-label">
              Selection prompt
            </label>
            <Textarea
              size="sm"
              id="term-extraction-selection-prompt"
              aria-label="Term extraction selection prompt"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={loading || saving || settings === null}
              readOnly={selectedPrompt?.isBuiltin}
              maxLength={settings?.maxChars}
              rows={16}
              className="resize-y font-mono leading-relaxed"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-text-muted">
            <span>{draft.length.toLocaleString()} characters</span>
            {settings && <span>Maximum {settings.maxChars.toLocaleString()}</span>}
          </div>

          {(creating || (selectedPrompt && !selectedPrompt.isBuiltin)) && (
            <div className="workspace-settings-actions">
              <Button variant="secondary" type="button" onClick={cancelEditing} disabled={saving}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || !dirty || !valid}
              >
                {saving ? 'Saving...' : creating ? 'Save and use' : 'Save changes'}
              </Button>
            </div>
          )}

          {selectedPrompt?.isBuiltin && (
            <p className="text-xs text-text-muted">
              Create a new prompt to customize the built-in rules.
            </p>
          )}
        </div>
      </div>

      {status && <div className="status-note">{status}</div>}
    </section>
  );
}
