import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ProjectSavedPrompt } from '../../../../../shared/ipc';
import { apiClient } from '../../../services/apiClient';
import { feedbackService } from '../../../services/feedbackService';
import type { ProjectSavedPromptsController } from './types';

interface UseProjectSavedPromptsParams {
  projectId: number | null;
  promptDraft: string;
  setPromptDraft: Dispatch<SetStateAction<string>>;
}

const NO_PROMPTS: ProjectSavedPrompt[] = [];

export function useProjectSavedPrompts({
  projectId,
  promptDraft,
  setPromptDraft,
}: UseProjectSavedPromptsParams): ProjectSavedPromptsController {
  const [loadedPrompts, setLoadedPrompts] = useState<{
    projectId: number;
    prompts: ProjectSavedPrompt[];
  } | null>(null);
  const prompts = loadedPrompts?.projectId === projectId ? loadedPrompts.prompts : NO_PROMPTS;
  const [reloadToken, setReloadToken] = useState(0);
  // Tracking the owning project id keeps the manager closed after a project
  // switch without needing a state reset inside an effect.
  const [managerOpenForProjectId, setManagerOpenForProjectId] = useState<number | null>(null);
  const managerOpen = managerOpenForProjectId !== null && managerOpenForProjectId === projectId;

  const openManager = useCallback(() => setManagerOpenForProjectId(projectId), [projectId]);
  const closeManager = useCallback(() => setManagerOpenForProjectId(null), []);

  const refreshPrompts = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    if (!projectId) return undefined;
    let cancelled = false;
    apiClient
      .listProjectSavedPrompts(projectId)
      .then((next) => {
        if (!cancelled) setLoadedPrompts({ projectId, prompts: next });
      })
      .catch(() => {
        // Keep whatever was last loaded: replacing it with [] makes a
        // transient IPC/DB failure look like the prompts were deleted.
        if (!cancelled) feedbackService.error('Failed to load saved prompts.');
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadToken]);

  const selectedPromptId = useMemo(() => {
    const normalizedDraft = promptDraft.trim();
    if (!normalizedDraft) return null;
    return prompts.find((prompt) => prompt.content.trim() === normalizedDraft)?.id ?? null;
  }, [prompts, promptDraft]);

  const isNameTaken = useCallback(
    (name: string, excludeId?: number) =>
      prompts.some(
        (prompt) => prompt.id !== excludeId && prompt.name.toLowerCase() === name.toLowerCase(),
      ),
    [prompts],
  );

  const applyPrompt = useCallback(
    async (promptId: number) => {
      const prompt = prompts.find((item) => item.id === promptId);
      if (!prompt) return false;
      // selectedPromptId === null means the draft is custom text that matches
      // no saved prompt; applying would silently discard it.
      const hasUnsavedDraftText =
        promptDraft.trim() !== '' &&
        selectedPromptId === null &&
        promptDraft.trim() !== prompt.content.trim();
      if (hasUnsavedDraftText) {
        const confirmed = await feedbackService.confirm(
          `Replace the current custom prompt draft with "${prompt.name}"? The unsaved draft text will be lost.`,
        );
        if (!confirmed) return false;
      }
      setPromptDraft(prompt.content);
      return true;
    },
    [prompts, promptDraft, selectedPromptId, setPromptDraft],
  );

  const saveDraftAsNewPrompt = useCallback(
    async (name: string) => {
      if (!projectId) return false;
      const trimmedName = name.trim();
      if (!trimmedName) {
        feedbackService.info('Please enter a prompt name.');
        return false;
      }
      if (isNameTaken(trimmedName)) {
        feedbackService.info(`A prompt named "${trimmedName}" already exists.`);
        return false;
      }
      try {
        await apiClient.createProjectSavedPrompt(projectId, trimmedName, promptDraft);
        refreshPrompts();
        return true;
      } catch {
        feedbackService.error('Failed to save prompt.');
        return false;
      }
    },
    [isNameTaken, refreshPrompts, projectId, promptDraft],
  );

  const updatePrompt = useCallback(
    async (promptId: number, name: string, content: string) => {
      if (!projectId) return false;
      const existing = prompts.find((item) => item.id === promptId);
      if (!existing) return false;
      const trimmedName = name.trim();
      if (!trimmedName) {
        feedbackService.info('Please enter a prompt name.');
        return false;
      }
      if (isNameTaken(trimmedName, promptId)) {
        feedbackService.info(`A prompt named "${trimmedName}" already exists.`);
        return false;
      }
      if (trimmedName === existing.name && content === existing.content) {
        return true;
      }
      try {
        await apiClient.updateProjectSavedPrompt(projectId, promptId, trimmedName, content);
        refreshPrompts();
        return true;
      } catch {
        feedbackService.error('Failed to update prompt.');
        return false;
      }
    },
    [isNameTaken, refreshPrompts, projectId, prompts],
  );

  const deletePrompt = useCallback(
    async (promptId: number) => {
      if (!projectId) return false;
      const existing = prompts.find((item) => item.id === promptId);
      if (!existing) return false;
      const confirmed = await feedbackService.confirm(`Delete saved prompt "${existing.name}"?`);
      if (!confirmed) return false;
      try {
        await apiClient.deleteProjectSavedPrompt(projectId, promptId);
        refreshPrompts();
        return true;
      } catch {
        feedbackService.error('Failed to delete prompt.');
        return false;
      }
    },
    [refreshPrompts, projectId, prompts],
  );

  return useMemo(
    () => ({
      prompts,
      selectedPromptId,
      managerOpen,
      openManager,
      closeManager,
      applyPrompt,
      saveDraftAsNewPrompt,
      updatePrompt,
      deletePrompt,
    }),
    [
      prompts,
      selectedPromptId,
      managerOpen,
      openManager,
      closeManager,
      applyPrompt,
      saveDraftAsNewPrompt,
      updatePrompt,
      deletePrompt,
    ],
  );
}
