import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  DEFAULT_PROJECT_QA_SETTINGS,
  normalizeQASettings,
  type Project,
  type ProjectQASettings,
} from '@cat/core/project';
import { apiClient } from '../../services/apiClient';
import { feedbackService } from '../../services/feedbackService';

interface Params {
  project: Project | null;
  setProject: Dispatch<SetStateAction<Project | null>>;
  runMutation: <T>(fn: () => Promise<T>) => Promise<T>;
}

function settingsKey(settings: ProjectQASettings) {
  const normalized = normalizeQASettings(settings);
  return JSON.stringify([
    normalized.instantQaOnConfirm,
    [...normalized.enabledRuleIds].sort(),
    [...normalized.disabledCheckIds!].sort(),
    normalized.options,
  ]);
}

export function useProjectQASettings({ project, setProject, runMutation }: Params) {
  const [edited, setEdited] = useState<{ projectId: number; value: ProjectQASettings } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const savePending = useRef(false);
  const saved = project?.qaSettings || DEFAULT_PROJECT_QA_SETTINGS;
  const draft = edited && edited.projectId === project?.id ? edited.value : saved;
  const hasChanges = settingsKey(draft) !== settingsKey(saved);

  const onChange = useCallback(
    (value: ProjectQASettings) => {
      if (project) setEdited({ projectId: project.id, value });
    },
    [project],
  );
  const discard = useCallback(() => setEdited(null), []);
  const save = useCallback(async () => {
    if (!project || !hasChanges || savePending.current) return;
    const projectId = project.id;
    const submitted = { ...draft, enabledRuleIds: [...draft.enabledRuleIds] };
    savePending.current = true;
    setSaving(true);
    try {
      await runMutation(async () => {
        await apiClient.updateProjectQASettings(projectId, submitted);
        setProject((current) =>
          current?.id === projectId ? { ...current, qaSettings: submitted } : current,
        );
      });
    } catch (error) {
      feedbackService.error(
        `Failed to save QA settings: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  }, [project, draft, hasChanges, runMutation, setProject]);

  return { draft, onChange, hasChanges, saving, save, discard };
}

export type ProjectQAController = ReturnType<typeof useProjectQASettings>;
