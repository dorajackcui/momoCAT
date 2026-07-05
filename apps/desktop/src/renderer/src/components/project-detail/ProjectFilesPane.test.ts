import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectAIController } from '../../hooks/projectDetail/useProjectAI';
import type { ProjectFileRecord } from '../../../../shared/ipc';
import { ProjectAITranslateModal } from './ProjectAITranslateModal';
import { buildProjectAITranslateStartOptions, ProjectFilesPane } from './ProjectFilesPane';

type CapturedButton = {
  label: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
};

type MockButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: string;
  size?: string;
  loading?: boolean;
  iconOnly?: boolean;
};

const capturedButtons = vi.hoisted<CapturedButton[]>(() => []);

vi.mock('../ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui')>();
  const react = await import('react');

  return {
    ...actual,
    Button: ({
      children,
      onClick,
      loading,
      variant,
      size,
      iconOnly,
      ...props
    }: MockButtonProps) => {
      const label = react.Children.toArray(children)
        .map((child) =>
          typeof child === 'string' || typeof child === 'number' ? String(child) : '',
        )
        .join('')
        .trim();
      capturedButtons.push({ label, onClick, disabled: Boolean(props.disabled || loading) });
      void variant;
      void size;
      void iconOnly;
      return react.createElement(
        'button',
        { ...props, disabled: props.disabled || loading, onClick },
        children,
      );
    },
  };
});

vi.mock('./ProjectAIPane', () => ({
  ProjectAIPane: () => React.createElement('div', { 'data-testid': 'project-ai-pane' }),
}));

function createFile(overrides?: Partial<ProjectFileRecord>): ProjectFileRecord {
  return {
    id: 1,
    uuid: 'file-1',
    projectId: 100,
    name: 'demo.xlsx',
    totalSegments: 10,
    confirmedSegments: 0,
    importOptionsJson: null,
    segmentStatusStats: {
      totalSegments: 10,
      qaProblemSegments: 0,
      confirmedSegmentsForBar: 0,
      inProgressSegments: 0,
      newSegments: 10,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createAIControllerMock(overrides?: Partial<ProjectAIController>): {
  ai: ProjectAIController;
  startAITranslateFile: ReturnType<typeof vi.fn>;
} {
  const startAITranslateFile = vi.fn().mockResolvedValue(undefined);
  const ai = {
    providerOptions: [
      {
        id: 'provider:gpt-5.4-mini',
        name: 'OpenAI / gpt-5.4-mini',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.4-mini',
        protocol: 'chat-completions',
        kind: 'configured',
        connectionId: 'connection:openai',
        connectionName: 'OpenAI',
        apiKeyLast4: '1234',
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: '1970-01-01T00:00:00.000Z',
      },
    ],
    modelDraft: 'provider:gpt-5.4-mini',
    setModelDraft: vi.fn(),
    effectiveSystemPromptPreview: 'You are a professional translator.',
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
    startAITranslateFile,
    cancelAITranslateFile: vi.fn().mockResolvedValue(undefined),
    getFileJob: vi.fn().mockReturnValue(null),
    subscribeFileJobs: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  } as unknown as ProjectAIController;

  return { ai, startAITranslateFile };
}

function renderPane(ai: ProjectAIController, projectType: 'translation' | 'review' | 'custom') {
  return renderToStaticMarkup(
    React.createElement(ProjectFilesPane, {
      files: [createFile()],
      onOpenFile: vi.fn(),
      onOpenCommitModal: vi.fn(),
      onOpenMatchModal: vi.fn(),
      onInspectFile: vi.fn().mockResolvedValue(undefined),
      onDeleteFile: vi.fn().mockResolvedValue(undefined),
      onExportFile: vi.fn().mockResolvedValue(undefined),
      onRunFileQA: vi.fn().mockResolvedValue(undefined),
      ai,
      projectType,
    }),
  );
}

describe('ProjectFilesPane', () => {
  it('shows a single AI Translate button in translation projects', () => {
    const { ai } = createAIControllerMock();
    const html = renderPane(ai, 'translation');

    expect(html).toContain('AI Translate');
    expect(html).toContain('TM/TB');
    expect(html).not.toContain('AI Dialogue');
    expect(html).not.toContain('AI Translate Options');
  });

  it('keeps file actions wrappable and visible on keyboard focus', () => {
    const { ai } = createAIControllerMock();
    const html = renderPane(ai, 'translation');

    expect(html).toContain('max-w-[34rem]');
    expect(html).toContain('flex-wrap');
    expect(html).toContain('justify-end');
    expect(html).toContain('group-focus-within:opacity-100');
  });

  it('does not duplicate file opening in the action buttons', () => {
    const { ai } = createAIControllerMock();
    capturedButtons.length = 0;

    renderPane(ai, 'translation');

    expect(capturedButtons.map((button) => button.label)).not.toContain('Open');
  });

  it('calls the inspect handler with the selected file', () => {
    const { ai } = createAIControllerMock();
    const file = createFile({ id: 77, name: 'inspect-me.xlsx' });
    const onInspectFile = vi.fn();
    capturedButtons.length = 0;

    renderToStaticMarkup(
      React.createElement(ProjectFilesPane, {
        files: [file],
        onOpenFile: vi.fn(),
        onOpenCommitModal: vi.fn(),
        onOpenMatchModal: vi.fn(),
        onInspectFile,
        onDeleteFile: vi.fn().mockResolvedValue(undefined),
        onExportFile: vi.fn().mockResolvedValue(undefined),
        onRunFileQA: vi.fn().mockResolvedValue(undefined),
        ai,
        projectType: 'translation',
      }),
    );

    const inspectButton = capturedButtons.find((button) => button.label === 'TM/TB');
    expect(inspectButton).toBeDefined();
    inspectButton?.onClick?.({} as React.MouseEvent<HTMLButtonElement>);

    expect(onInspectFile).toHaveBeenCalledWith(file);
  });

  it('turns a running AI file job into a Stop action', () => {
    const cancelAITranslateFile = vi.fn().mockResolvedValue(undefined);
    const { ai } = createAIControllerMock({
      cancelAITranslateFile,
      getFileJob: vi.fn().mockReturnValue({
        kind: 'ai-translate-file',
        jobId: 'job-1',
        fileId: 1,
        progress: 42,
        status: 'running',
        message: 'AI translation running',
      }),
    } as Partial<ProjectAIController>);
    capturedButtons.length = 0;

    const html = renderPane(ai, 'translation');

    expect(html).toContain('Stop');
    expect(html).not.toContain('AI Translating...');
    const stopButton = capturedButtons.find((button) => button.label === 'Stop');
    expect(stopButton).toBeDefined();
    expect(stopButton?.disabled).toBe(false);

    stopButton?.onClick?.({} as React.MouseEvent<HTMLButtonElement>);

    expect(cancelAITranslateFile).toHaveBeenCalledWith(1);
  });

  it('renders target baseline options without legacy translation scope controls', () => {
    const html = renderToStaticMarkup(
      React.createElement(ProjectAITranslateModal, {
        open: true,
        fileName: 'demo.xlsx',
        onClose: vi.fn(),
        onConfirm: vi.fn(),
      }),
    );

    expect(html).toContain('AI Translate Options');
    expect(html).toContain('Target Baseline');
    expect(html).toContain('Use Current Targets');
    expect(html).toContain('Ignore Current Targets');
    expect(html).toContain('Confirmed segments stay locked.');
    expect(html).not.toContain('Translation Scope');
    expect(html).not.toContain('Dialogue Mode');
  });

  it('submits modal options as target baseline without extra confirm', () => {
    expect(buildProjectAITranslateStartOptions({ targetBaseline: 'use-current-targets' })).toEqual({
      targetBaseline: 'use-current-targets',
      confirm: false,
    });

    expect(
      buildProjectAITranslateStartOptions({ targetBaseline: 'ignore-current-targets' }),
    ).toEqual({
      targetBaseline: 'ignore-current-targets',
      confirm: false,
    });
  });

  it('keeps one-click AI action for non-translation projects', () => {
    const { ai } = createAIControllerMock();
    const html = renderPane(ai, 'review');

    expect(html).toContain('AI Review');
    expect(html).not.toContain('TM/TB');
    expect(html).not.toContain('AI Translate Options');
  });

  it('does not show Inspect for custom projects', () => {
    const { ai } = createAIControllerMock();
    const html = renderPane(ai, 'custom');

    expect(html).toContain('AI Process');
    expect(html).not.toContain('TM/TB');
  });
});
