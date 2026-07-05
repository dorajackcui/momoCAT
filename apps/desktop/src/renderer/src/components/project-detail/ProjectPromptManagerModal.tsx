import { useState } from 'react';
import type { ProjectSavedPromptsController } from '../../hooks/projectDetail/useProjectAI';
import { Button, Input, Modal, Textarea } from '../ui';

interface ProjectPromptManagerModalProps {
  open: boolean;
  onClose: () => void;
  savedPrompts: ProjectSavedPromptsController;
  currentDraft: string;
}

export function ProjectPromptManagerModal({
  open,
  onClose,
  savedPrompts,
  currentDraft,
}: ProjectPromptManagerModalProps) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSaveAsNew = async () => {
    setBusy(true);
    const saved = await savedPrompts.saveDraftAsNewPrompt(newName);
    if (saved) setNewName('');
    setBusy(false);
  };

  const handleSaveEdit = async () => {
    if (editingId === null) return;
    setBusy(true);
    const saved = await savedPrompts.updatePrompt(editingId, editName, editContent);
    if (saved) setEditingId(null);
    setBusy(false);
  };

  const handleDelete = async (promptId: number) => {
    setBusy(true);
    await savedPrompts.deletePrompt(promptId);
    setBusy(false);
  };

  return (
    <Modal open={open} onClose={onClose} title="Saved Prompts" size="lg">
      <div className="space-y-4">
        <div>
          <label
            htmlFor="saved-prompt-new-name"
            className="block text-xs font-bold text-text-faint uppercase tracking-wider mb-1"
          >
            Save Current Prompt As
          </label>
          <div className="flex gap-2">
            <Input
              id="saved-prompt-new-name"
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Prompt name"
              className="flex-1"
            />
            <Button
              onClick={() => void handleSaveAsNew()}
              disabled={busy || !newName.trim()}
              size="sm"
              variant="primary"
            >
              Save
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-text-muted">
            Saves the custom prompt text currently in the editor under a new name.
          </p>
        </div>
        <div className="space-y-2">
          {savedPrompts.prompts.length === 0 ? (
            <div className="surface-subtle rounded-xl px-3 py-4 text-sm text-text-muted">
              No saved prompts yet.
            </div>
          ) : (
            savedPrompts.prompts.map((prompt) =>
              editingId === prompt.id ? (
                <div key={prompt.id} className="surface-subtle rounded-xl px-3 py-3 space-y-2">
                  <Input
                    type="text"
                    aria-label="Prompt Name"
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                  />
                  <Textarea
                    aria-label="Prompt Content"
                    value={editContent}
                    onChange={(event) => setEditContent(event.target.value)}
                    rows={5}
                    className="text-xs"
                  />
                  <div className="flex justify-end gap-2">
                    <Button onClick={() => setEditingId(null)} size="sm" variant="ghost">
                      Cancel
                    </Button>
                    <Button
                      onClick={() => void handleSaveEdit()}
                      disabled={busy || !editName.trim()}
                      size="sm"
                      variant="primary"
                    >
                      Save Changes
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  key={prompt.id}
                  className="surface-subtle rounded-xl px-3 py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-text truncate">
                        {prompt.name}
                      </span>
                      {savedPrompts.selectedPromptId === prompt.id && (
                        <span className="text-[10px] uppercase tracking-wider text-success">
                          In use
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-text-muted truncate">
                      {prompt.content.trim() || 'Empty prompt'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      onClick={() => {
                        savedPrompts.applyPrompt(prompt.id);
                        onClose();
                      }}
                      disabled={busy}
                      size="sm"
                      variant="soft"
                    >
                      Apply
                    </Button>
                    <Button
                      onClick={() => {
                        setEditingId(prompt.id);
                        setEditName(prompt.name);
                        setEditContent(prompt.content);
                      }}
                      disabled={busy}
                      size="sm"
                      variant="ghost"
                    >
                      Edit
                    </Button>
                    <Button
                      onClick={() => void handleDelete(prompt.id)}
                      disabled={busy}
                      size="sm"
                      variant="ghost"
                      className="!text-danger"
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ),
            )
          )}
        </div>
        {currentDraft.trim().length === 0 && (
          <p className="text-[11px] text-text-faint">
            Tip: the custom prompt editor is currently empty; applying a saved prompt fills it.
          </p>
        )}
      </div>
    </Modal>
  );
}
