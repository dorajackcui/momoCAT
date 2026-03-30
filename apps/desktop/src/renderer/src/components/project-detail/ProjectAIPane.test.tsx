import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectAIController } from '../../hooks/projectDetail/useProjectAI';
import { ProjectAIPane } from './ProjectAIPane';

function createController(overrides?: Partial<ProjectAIController>): ProjectAIController {
  return {
    providerOptions: [
      {
        id: 'builtin:openai:gpt-5.4-mini',
        name: 'OpenAI / gpt-5.4-mini',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.4-mini',
        protocol: 'chat-completions',
        kind: 'builtin',
        apiKeyLast4: '1234',
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: '1970-01-01T00:00:00.000Z',
      },
      {
        id: 'custom:demo',
        name: 'Demo Provider',
        baseUrl: 'https://example.com/v1',
        model: 'gpt-demo',
        protocol: 'chat-completions',
        kind: 'custom',
        apiKeyLast4: '9999',
        createdAt: '2026-03-30T00:00:00.000Z',
        updatedAt: '2026-03-30T00:00:00.000Z',
      },
    ],
    modelDraft: 'builtin:openai:gpt-5.4-mini',
    setModelDraft: vi.fn(),
    promptDraft: '',
    setPromptDraft: vi.fn(),
    promptSavedAt: null,
    savingPrompt: false,
    testSource: '',
    setTestSource: vi.fn(),
    testContext: '',
    setTestContext: vi.fn(),
    testResult: null,
    testPromptUsed: null,
    testUserMessage: null,
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
  it('renders builtin and custom providers in the provider select', () => {
    const controller = createController();
    render(<ProjectAIPane ai={controller} />);

    expect(screen.getByRole('option', { name: 'OpenAI / gpt-5.4-mini' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Demo Provider' })).toBeInTheDocument();
  });

  it('updates the selected provider id when the dropdown changes', () => {
    const controller = createController();
    render(<ProjectAIPane ai={controller} />);

    fireEvent.change(screen.getByLabelText('AI Provider'), {
      target: { value: 'custom:demo' },
    });

    expect(controller.setModelDraft).toHaveBeenCalledWith('custom:demo');
  });
});
