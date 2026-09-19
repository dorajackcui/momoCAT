// @vitest-environment jsdom
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROJECT_QA_SETTINGS, type Project, type ProjectType } from '@cat/core/project';
import { createAIFileJobTracker } from '../../hooks/aiFileJobs';
import { useProjectAI } from '../../hooks/projectDetail/useProjectAI';
import { useProjectQASettings } from '../../hooks/projectDetail/useProjectQASettings';
import { apiClient } from '../../services/apiClient';
import { feedbackService } from '../../services/feedbackService';
import { Button } from '../ui';
import { ProjectSettingsPane, type ProjectSettingsSection } from './ProjectSettingsPane';

vi.mock('../../services/apiClient', () => ({
  apiClient: {
    listAIProviders: vi.fn(),
    listProjectSavedPrompts: vi.fn(),
    onJobProgress: vi.fn(),
    updateProjectAISettings: vi.fn(),
    updateProjectQASettings: vi.fn(),
  },
}));
vi.mock('../../services/feedbackService', () => ({ feedbackService: { error: vi.fn() } }));

const initialProject: Project = {
  id: 1,
  uuid: 'project-1',
  name: 'Settings example',
  srcLang: 'en',
  tgtLang: 'fr',
  projectType: 'translation',
  aiPrompt: 'Saved instructions.',
  aiModel: 'provider:one',
  createdAt: '',
  updatedAt: '',
  qaSettings: DEFAULT_PROJECT_QA_SETTINGS,
};
const loadData = vi.fn().mockResolvedValue(undefined);
const runMutation = async <T,>(fn: () => Promise<T>) => fn();

function Harness({ projectType = 'translation' }: { projectType?: ProjectType }) {
  const [project, setProject] = useState<Project | null>({ ...initialProject, projectType });
  const [section, setSection] = useState<ProjectSettingsSection>('ai');
  const [visible, setVisible] = useState(true);
  const [tracker] = useState(createAIFileJobTracker);
  const ai = useProjectAI({ project, setProject, loadData, runMutation, fileJobTracker: tracker });
  const qa = useProjectQASettings({ project, setProject, runMutation });
  return (
    <>
      <Button onClick={() => setVisible(false)}>Tasks</Button>
      <Button onClick={() => setVisible(true)}>Settings</Button>
      <Button onClick={() => setProject({ ...initialProject, id: 2, aiPrompt: 'Other project.' })}>
        Other project
      </Button>
      {visible && (
        <ProjectSettingsPane
          ai={ai}
          qa={qa}
          projectType={projectType}
          section={section}
          onSectionChange={setSection}
        />
      )}
    </>
  );
}

function switchSection(name: 'AI' | 'QA') {
  fireEvent.mouseDown(screen.getByRole('tab', { name, exact: true }), {
    button: 0,
    ctrlKey: false,
  });
}
const promptInput = () => screen.getByLabelText('Custom Prompt');
const tagRule = () => screen.getByRole('checkbox', { name: /Tag Integrity/ });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
const discard = () => fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.listAIProviders).mockResolvedValue(
    ['one', 'two'].map((id) => ({
      id: `provider:${id}`,
      name: `Provider ${id}`,
      model: id,
      baseUrl: 'https://example.com/v1',
      protocol: 'chat-completions',
      kind: 'configured',
      connectionId: 'connection:demo',
      connectionName: 'Demo',
      apiKeyLast4: '',
      createdAt: '',
      updatedAt: '',
    })),
  );
  vi.mocked(apiClient.listProjectSavedPrompts).mockResolvedValue([]);
  vi.mocked(apiClient.onJobProgress).mockReturnValue(() => {});
  vi.mocked(apiClient.updateProjectAISettings).mockResolvedValue(undefined);
  vi.mocked(apiClient.updateProjectQASettings).mockResolvedValue(undefined);
});

describe('Project settings', () => {
  it('retains both drafts across sections and Tasks, and saves only the active section', async () => {
    render(<Harness />);
    await screen.findByRole('option', { name: 'Provider one' });
    fireEvent.change(promptInput(), { target: { value: 'New instructions.' } });
    switchSection('QA');
    fireEvent.click(tagRule());
    fireEvent.click(screen.getByRole('button', { name: 'Tasks', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings', exact: true }));
    expect(tagRule()).not.toBeChecked();
    save();
    await screen.findByRole('status');
    expect(apiClient.updateProjectQASettings).toHaveBeenCalledWith(1, {
      enabledRuleIds: ['terminology-consistency'],
      instantQaOnConfirm: true,
    });
    expect(apiClient.updateProjectAISettings).not.toHaveBeenCalled();
    switchSection('AI');
    expect(promptInput()).toHaveValue('New instructions.');
    save();
    await screen.findByRole('status');
    expect(apiClient.updateProjectAISettings).toHaveBeenCalledWith(
      1,
      'New instructions.',
      'provider:one',
    );
  });

  it('discards provider and prompt together, and leaves the other section draft intact', async () => {
    render(<Harness />);
    await screen.findByRole('option', { name: 'Provider two' });
    fireEvent.change(promptInput(), { target: { value: 'Unsaved.' } });
    fireEvent.change(screen.getByLabelText('AI Provider'), { target: { value: 'provider:two' } });
    switchSection('QA');
    fireEvent.click(tagRule());
    switchSection('AI');
    discard();
    expect(promptInput()).toHaveValue('Saved instructions.');
    expect(screen.getByLabelText('AI Provider')).toHaveValue('provider:one');
    switchSection('QA');
    expect(tagRule()).not.toBeChecked();
    discard();
    expect(tagRule()).toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(apiClient.updateProjectAISettings).not.toHaveBeenCalled();
    expect(apiClient.updateProjectQASettings).not.toHaveBeenCalled();
  });

  it.each(['AI', 'QA'] as const)(
    'preserves %s changes after a save failure and permits retry',
    async (section) => {
      const update =
        section === 'AI' ? apiClient.updateProjectAISettings : apiClient.updateProjectQASettings;
      vi.mocked(update).mockRejectedValueOnce(new Error('Save unavailable'));
      render(<Harness />);
      await screen.findByRole('option', { name: 'Provider one' });
      if (section === 'AI') fireEvent.change(promptInput(), { target: { value: 'Retry me.' } });
      else {
        switchSection('QA');
        fireEvent.click(tagRule());
      }
      save();
      await waitFor(() => expect(feedbackService.error).toHaveBeenCalled());
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      if (section === 'AI') expect(promptInput()).toHaveValue('Retry me.');
      else expect(tagRule()).not.toBeChecked();
      save();
      await screen.findByRole('status');
      expect(update).toHaveBeenCalledTimes(2);
    },
  );

  it.each(['AI', 'QA'] as const)(
    'does not apply a delayed %s save to a different project',
    async (section) => {
      let finish!: () => void;
      const update =
        section === 'AI' ? apiClient.updateProjectAISettings : apiClient.updateProjectQASettings;
      vi.mocked(update).mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      render(<Harness />);
      await screen.findByRole('option', { name: 'Provider one' });
      if (section === 'AI') fireEvent.change(promptInput(), { target: { value: 'Pending.' } });
      else {
        switchSection('QA');
        fireEvent.click(tagRule());
      }
      save();
      expect(section === 'AI' ? promptInput() : tagRule()).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Other project' }));
      await act(async () => finish());
      if (section === 'QA') expect(tagRule()).toBeChecked();
      switchSection('AI');
      expect(promptInput()).toHaveValue('Other project.');
      expect(screen.getByRole('status')).toHaveTextContent('Saved');
    },
  );

  it.each(['review', 'custom'] as const)(
    'keeps %s settings limited to supported configuration',
    async (projectType) => {
      render(<Harness projectType={projectType} />);
      await screen.findByRole('option', { name: 'Provider one' });
      expect(screen.getByRole('tab', { name: 'AI', exact: true })).toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: 'QA', exact: true })).not.toBeInTheDocument();
    },
  );
});
