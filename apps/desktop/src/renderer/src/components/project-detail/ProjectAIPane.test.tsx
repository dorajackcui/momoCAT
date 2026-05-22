import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectAIController } from '../../hooks/projectDetail/useProjectAI';
import { ProjectAIPane } from './ProjectAIPane';

function createController(overrides?: Partial<ProjectAIController>): ProjectAIController {
  return {
    providerOptions: [
      {
        id: 'provider:gpt-demo',
        name: 'OpenAI / gpt-demo',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-demo',
        protocol: 'chat-completions',
        kind: 'configured',
        connectionId: 'connection:openai',
        connectionName: 'OpenAI',
        apiKeyLast4: '1234',
        createdAt: '2026-05-22T00:00:00.000Z',
        updatedAt: '2026-05-22T00:00:00.000Z',
      },
      {
        id: 'provider:gpt-demo-mini',
        name: 'OpenAI / gpt-demo-mini',
        baseUrl: 'https://example.com/v1',
        model: 'gpt-demo-mini',
        protocol: 'chat-completions',
        kind: 'configured',
        connectionId: 'connection:openai',
        connectionName: 'OpenAI',
        apiKeyLast4: '9999',
        createdAt: '2026-05-22T00:00:00.000Z',
        updatedAt: '2026-05-22T00:00:00.000Z',
      },
    ],
    modelDraft: 'provider:gpt-demo',
    setModelDraft: vi.fn(),
    providerUnavailable: false,
    providerSetupRequired: false,
    providerWarning: null,
    effectiveSystemPromptPreview:
      'You are a professional translator.\n\nFrom en to zh. Output in zh ONLY.\nKeep all protected markers exactly as they appear, including forms such as {1>, <2}, {3}\nPreserve all escape sequences exactly as they appear, including \\n and \\r.\nReturn only the translated text, without quotes or extra commentary',
    promptDraft: '',
    setPromptDraft: vi.fn(),
    promptSavedAt: null,
    savingPrompt: false,
    testSource: '',
    setTestSource: vi.fn(),
    testContext: '',
    setTestContext: vi.fn(),
    testResult: null,
    testSystemPrompt: null,
    testUserPrompt: null,
    testMeta: null,
    testError: null,
    testRawResponse: null,
    showTestDetails: false,
    setShowTestDetails: vi.fn(),
    hasUnsavedPromptChanges: false,
    hasTestDetails: false,
    savePrompt: vi.fn().mockResolvedValue(undefined),
    testPrompt: vi.fn().mockResolvedValue(undefined),
    startAITranslateFile: vi.fn().mockResolvedValue(undefined),
    getFileJob: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

describe('ProjectAIPane', () => {
  it('renders a read-only effective prompt preview and editable custom prompt', () => {
    const controller = createController({
      promptDraft: 'Use concise style.',
    });
    render(<ProjectAIPane ai={controller} />);

    expect(screen.getByLabelText('Prompt')).toHaveValue(
      'You are a professional translator.\n\nFrom en to zh. Output in zh ONLY.\nKeep all protected markers exactly as they appear, including forms such as {1>, <2}, {3}\nPreserve all escape sequences exactly as they appear, including \\n and \\r.\nReturn only the translated text, without quotes or extra commentary',
    );
    expect(screen.getByLabelText('Prompt')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Custom Prompt')).toHaveValue('Use concise style.');
    expect(
      screen.getByText('This is the saved system prompt used at runtime. It updates after you save AI settings.'),
    ).toBeInTheDocument();
  });

  it('renders configured providers in the provider select', () => {
    const controller = createController();
    render(<ProjectAIPane ai={controller} />);

    expect(screen.getByText('AI Provider')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'OpenAI / gpt-demo' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'OpenAI / gpt-demo-mini' })).toBeInTheDocument();
  });

  it('updates the selected provider id when the dropdown changes', () => {
    const controller = createController();
    render(<ProjectAIPane ai={controller} />);

    fireEvent.change(screen.getByLabelText('AI Provider'), {
      target: { value: 'provider:gpt-demo-mini' },
    });

    expect(controller.setModelDraft).toHaveBeenCalledWith('provider:gpt-demo-mini');
  });

  it('shows setup guidance when no providers are configured', () => {
    const controller = createController({
      providerOptions: [],
      modelDraft: '',
      providerSetupRequired: true,
      providerWarning: 'Add an AI provider in Settings before running AI actions.',
    });

    render(<ProjectAIPane ai={controller} />);

    expect(
      screen.getByText('Add an AI provider in Settings before running AI actions.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('AI Provider')).toBeDisabled();
  });

  it('keeps the unavailable selected provider visible as a stable option', () => {
    const controller = createController({
      modelDraft: 'provider:missing',
      providerUnavailable: true,
      providerWarning:
        'The saved AI provider is no longer available. Choose a configured provider and save.',
    });

    render(<ProjectAIPane ai={controller} />);

    expect(
      screen.getByRole('option', { name: 'Unavailable provider (provider:missing)' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('AI Provider')).toHaveValue('provider:missing');
  });

  it('shows custom project override copy in the custom prompt section', () => {
    const controller = createController();
    render(<ProjectAIPane ai={controller} projectType="custom" />);

    expect(
      screen.getByPlaceholderText(
        'Optional. Override the default system prompt with full custom processing instructions.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Saved custom prompt overrides the default system prompt.'),
    ).toBeInTheDocument();
  });
});
