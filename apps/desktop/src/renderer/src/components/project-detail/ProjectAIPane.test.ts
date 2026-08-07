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
    savedPrompts: {
      prompts: [],
      selectedPromptId: null,
      managerOpen: false,
      openManager: vi.fn(),
      closeManager: vi.fn(),
      applyPrompt: vi.fn(),
      saveDraftAsNewPrompt: vi.fn().mockResolvedValue(true),
      updatePrompt: vi.fn().mockResolvedValue(true),
      deletePrompt: vi.fn().mockResolvedValue(true),
    },
    savePrompt: vi.fn().mockResolvedValue(undefined),
    testPrompt: vi.fn().mockResolvedValue(undefined),
    startAITranslateFile: vi.fn().mockResolvedValue(undefined),
    cancelAITranslateFile: vi.fn().mockResolvedValue(undefined),
    getFileJob: vi.fn().mockReturnValue(null),
    subscribeFileJobs: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}

type TestElement = React.ReactElement<Record<string, unknown>>;
type ElementPredicate = (element: TestElement) => boolean;

function renderPane(
  controller: ProjectAIController,
  projectType?: 'translation' | 'review' | 'custom',
  expanded = true,
  onToggle = vi.fn(),
) {
  return renderToStaticMarkup(
    React.createElement(ProjectAIPane, {
      ai: controller,
      projectType: projectType ?? 'translation',
      expanded,
      onToggle,
    }),
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
  expanded = true,
  onToggle = vi.fn(),
): TestElement {
  const root = React.createElement(ProjectAIPane, {
    ai: controller,
    expanded,
    onToggle,
  });
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
  it('renders a compact provider summary and hides the settings form when collapsed', () => {
    const onToggle = vi.fn();
    const controller = createController();
    const html = renderPane(controller, 'translation', false, onToggle);
    const toggle = findElementForController(
      controller,
      (element) => element.type === 'button' && element.props['aria-expanded'] === false,
      false,
      onToggle,
    );

    expect(html).toContain('AI Settings');
    expect(html).toContain('OpenAI / gpt-demo');
    expect(html).toContain('Saved');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('border-border');
    expect(html).not.toContain('surface-subtle');
    expect(html).not.toContain('project-ai-effective-prompt');
    expect(html).not.toContain('AI Settings Saved');

    (toggle.props.onClick as () => void)();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('keeps the save action available while collapsed when settings have changed', () => {
    const controller = createController({ hasUnsavedPromptChanges: true });
    const html = renderPane(controller, 'translation', false);

    expect(html).toContain('Unsaved Changes');
    expect(html).toContain('Save AI Settings');
  });

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

  it('lists saved prompts in the switcher and applies the chosen prompt', () => {
    const applyPrompt = vi.fn();
    const controller = createController({
      savedPrompts: {
        prompts: [
          {
            id: 1,
            projectId: 9,
            name: 'Formal tone',
            content: 'Formal content',
            createdAt: '2026-07-01T00:00:00.000Z',
            updatedAt: '2026-07-01T00:00:00.000Z',
          },
          {
            id: 2,
            projectId: 9,
            name: 'Casual tone',
            content: 'Casual content',
            createdAt: '2026-07-01T00:00:00.000Z',
            updatedAt: '2026-07-01T00:00:00.000Z',
          },
        ],
        selectedPromptId: 2,
        managerOpen: false,
        openManager: vi.fn(),
        closeManager: vi.fn(),
        applyPrompt,
        saveDraftAsNewPrompt: vi.fn().mockResolvedValue(true),
        updatePrompt: vi.fn().mockResolvedValue(true),
        deletePrompt: vi.fn().mockResolvedValue(true),
      },
    });
    const html = renderPane(controller);

    expect(html).toContain('Formal tone');
    expect(html).toContain('Casual tone');

    const savedPromptSelect = findElementForController(
      controller,
      (element) => element.type === Select && element.props.id === 'project-ai-saved-prompt',
    );
    expect(savedPromptSelect.props.value).toBe(2);
    const onChange = savedPromptSelect.props.onChange as (event: {
      target: { value: string };
    }) => void;

    onChange({ target: { value: '1' } });

    expect(applyPrompt).toHaveBeenCalledWith(1);
  });

  it('opens the saved prompt manager from the manage button', () => {
    const openManager = vi.fn();
    const controller = createController({
      savedPrompts: {
        prompts: [],
        selectedPromptId: null,
        managerOpen: false,
        openManager,
        closeManager: vi.fn(),
        applyPrompt: vi.fn(),
        saveDraftAsNewPrompt: vi.fn().mockResolvedValue(true),
        updatePrompt: vi.fn().mockResolvedValue(true),
        deletePrompt: vi.fn().mockResolvedValue(true),
      },
    });
    const manageButton = findElementForController(
      controller,
      (element) => element.type === Button && element.props.children === 'Manage',
    );

    (manageButton.props.onClick as () => void)();

    expect(openManager).toHaveBeenCalledTimes(1);
  });
});
