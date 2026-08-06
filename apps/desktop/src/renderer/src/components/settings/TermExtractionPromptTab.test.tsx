// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceTerminologyPromptSettings } from '../../../../shared/ipc';
import { TermExtractionPromptTab } from './TermExtractionPromptTab';

const settings: SourceTerminologyPromptSettings = {
  prompt: 'Default extraction rules.',
  activePromptId: 'builtin:default',
  prompts: [
    {
      id: 'builtin:default',
      name: 'Default',
      prompt: 'Default extraction rules.',
      isBuiltin: true,
    },
    {
      id: 'prompt-secondary',
      name: 'Secondary',
      prompt: 'Prefer named secondary concepts.',
      isBuiltin: false,
    },
    {
      id: 'prompt-tertiary',
      name: 'Tertiary',
      prompt: 'Prefer named tertiary concepts.',
      isBuiltin: false,
    },
  ],
  maxChars: 12000,
  maxNameChars: 80,
};

const apiClientMock = vi.hoisted(() => ({
  getSourceTerminologyPromptSettings: vi.fn(),
  setSourceTerminologyPromptSettings: vi.fn(),
}));
const feedbackServiceMock = vi.hoisted(() => ({ confirm: vi.fn() }));

vi.mock('../../services/apiClient', () => ({ apiClient: apiClientMock }));
vi.mock('../../services/feedbackService', () => ({ feedbackService: feedbackServiceMock }));

describe('TermExtractionPromptTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClientMock.getSourceTerminologyPromptSettings.mockResolvedValue(settings);
    feedbackServiceMock.confirm.mockResolvedValue(true);
  });

  it('uses the prompt currently being viewed as the seed for a new prompt', async () => {
    render(<TermExtractionPromptTab />);

    const editor = await screen.findByLabelText('Term extraction selection prompt');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Secondary' }));
    await waitFor(() => expect(editor).toHaveValue('Prefer named secondary concepts.'));

    fireEvent.click(screen.getByRole('button', { name: 'New Prompt' }));

    expect(await screen.findByLabelText('Prompt Name')).toHaveValue('');
    expect(editor).toHaveValue('Prefer named secondary concepts.');

    fireEvent.click(screen.getByRole('button', { name: 'View Default' }));
    await waitFor(() => expect(editor).toHaveValue('Default extraction rules.'));
    expect(feedbackServiceMock.confirm).not.toHaveBeenCalled();
  });

  it('does not discard an edited prompt when deleting another prompt is cancelled', async () => {
    feedbackServiceMock.confirm.mockResolvedValueOnce(false);
    render(<TermExtractionPromptTab />);

    const editor = await screen.findByLabelText('Term extraction selection prompt');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Secondary' }));
    await waitFor(() => expect(editor).toHaveValue('Prefer named secondary concepts.'));
    fireEvent.change(editor, { target: { value: 'Unsaved secondary changes.' } });

    fireEvent.click(screen.getByRole('button', { name: 'Delete Tertiary' }));

    await waitFor(() =>
      expect(feedbackServiceMock.confirm).toHaveBeenCalledWith(
        'Discard unsaved prompt changes and delete saved prompt "Tertiary"?',
      ),
    );
    expect(apiClientMock.setSourceTerminologyPromptSettings).not.toHaveBeenCalled();
    expect(editor).toHaveValue('Unsaved secondary changes.');
  });

  it('surfaces prompt catalog recovery warnings', async () => {
    apiClientMock.getSourceTerminologyPromptSettings.mockResolvedValueOnce({
      ...settings,
      loadWarning: 'One invalid saved prompt was not loaded.',
    });
    render(<TermExtractionPromptTab />);

    expect(
      await screen.findByText('Prompt library warning: One invalid saved prompt was not loaded.'),
    ).toBeInTheDocument();
  });
});
