import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectAIController } from '../../hooks/projectDetail/useProjectAI';
import { Button, Select, Textarea } from '../ui';
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
    subscribeFileJobs: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}

type TestElement = React.ReactElement<Record<string, unknown>>;
type ElementPredicate = (element: TestElement) => boolean;

function renderPane(controller: ProjectAIController, projectType?: 'translation' | 'review' | 'custom') {
  return renderToStaticMarkup(
    React.createElement(ProjectAIPane, { ai: controller, projectType: projectType ?? 'translation' }),
  );
}

function getElementChildren(element: TestElement): React.ReactNode[] {
  return React.Children.toArray(element.props.children as React.ReactNode);
}

function findElement(node: React.ReactNode, predicate: ElementPredicate): TestElement | null {
  if (!React.isValidElement(node)) {
    return null;
  }

  const element = node as TestElement;

  if (predicate(element)) {
    return element;
  }

  if (typeof element.type === 'function') {
    const rendered = element.type(element.props);
    const match = findElement(rendered, predicate);
    if (match) {
      return match;
    }
  }

  for (const child of getElementChildren(element)) {
    const match = findElement(child, predicate);
    if (match) {
      return match;
    }
  }

  return null;
}

function findElementForController(
  controller: ProjectAIController,
  predicate: ElementPredicate,
): TestElement {
  const root = React.createElement(ProjectAIPane, { ai: controller });
  const match = findElement(root, predicate);
  if (!match) {
    throw new Error('Expected ProjectAIPane element was not found.');
  }
  return match;
}

function findTestPromptButton(controller: ProjectAIController): TestElement {
  return findElementForController(
    controller,
    (element) => element.type === Button && element.props.children === 'Test Prompt',
  );
}

describe('ProjectAIPane', () => {
  it('renders a read-only effective prompt preview and editable custom prompt', () => {
    const controller = createController({
      promptDraft: 'Use concise style.',
    });
    const html = renderPane(controller);
    const effectivePrompt = findElementForController(
      controller,
      (element) => element.type === Textarea && element.props.id === 'project-ai-effective-prompt',
    );
    const customPrompt = findElementForController(
      controller,
      (element) => element.type === Textarea && element.props.id === 'project-ai-custom-prompt',
    );

    expect(effectivePrompt.props.value).toBe(
      'You are a professional translator.\n\nFrom en to zh. Output in zh ONLY.\nKeep all protected markers exactly as they appear, including forms such as {1>, <2}, {3}\nPreserve all escape sequences exactly as they appear, including \\n and \\r.\nReturn only the translated text, without quotes or extra commentary',
    );
    expect(effectivePrompt.props.readOnly).toBe(true);
    expect(customPrompt.props.value).toBe('Use concise style.');
    expect(html).toContain(
      'This is the saved system prompt used at runtime. It updates after you save AI settings.',
    );
  });

  it('renders configured providers in the provider select', () => {
    const controller = createController();
    const html = renderPane(controller);

    expect(html).toContain('AI Provider');
    expect(html).toContain('OpenAI / gpt-demo');
    expect(html).toContain('OpenAI / gpt-demo-mini');
  });

  it('updates the selected provider id when the dropdown changes', () => {
    const controller = createController();
    const providerSelect = findElementForController(
      controller,
      (element) => element.type === Select && element.props.id === 'project-ai-provider',
    );
    const onChange = providerSelect.props.onChange as (event: {
      target: { value: string };
    }) => void;

    onChange({ target: { value: 'provider:gpt-demo-mini' } });

    expect(controller.setModelDraft).toHaveBeenCalledWith('provider:gpt-demo-mini');
  });

  it('shows setup guidance when no providers are configured', () => {
    const controller = createController({
      providerOptions: [],
      modelDraft: '',
      providerSetupRequired: true,
      providerWarning: 'Add an AI provider in Settings before running AI actions.',
    });
    const html = renderPane(controller);
    const providerSelect = findElementForController(
      controller,
      (element) => element.type === Select && element.props.id === 'project-ai-provider',
    );
    const testPromptButton = findTestPromptButton(controller);

    expect(html).toContain('Add an AI provider in Settings before running AI actions.');
    expect(providerSelect.props.disabled).toBe(true);
    expect(testPromptButton.props.disabled).toBe(true);
  });

  it('keeps the unavailable selected provider visible as a stable option', () => {
    const controller = createController({
      modelDraft: 'provider:missing',
      providerUnavailable: true,
      providerWarning:
        'The saved AI provider is no longer available. Choose a configured provider and save.',
    });
    const html = renderPane(controller);
    const providerSelect = findElementForController(
      controller,
      (element) => element.type === Select && element.props.id === 'project-ai-provider',
    );
    const testPromptButton = findTestPromptButton(controller);

    expect(html).toContain('Unavailable provider (provider:missing)');
    expect(providerSelect.props.value).toBe('provider:missing');
    expect(testPromptButton.props.disabled).toBe(true);
  });

  it('shows custom project override copy in the custom prompt section', () => {
    const controller = createController();
    const html = renderPane(controller, 'custom');

    expect(html).toContain(
      'Optional. Override the default system prompt with full custom processing instructions.',
    );
    expect(html).toContain('Saved custom prompt overrides the default system prompt.');
  });
});
