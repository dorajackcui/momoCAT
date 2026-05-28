import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectAIController } from '../../hooks/projectDetail/useProjectAI';
import type { ProjectFileRecord } from '../../../../shared/ipc';
import { ProjectAITranslateModal } from './ProjectAITranslateModal';
import { buildProjectAITranslateStartOptions, ProjectFilesPane } from './ProjectFilesPane';

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
    savePrompt: vi.fn().mockResolvedValue(undefined),
    testPrompt: vi.fn().mockResolvedValue(undefined),
    startAITranslateFile,
    getFileJob: vi.fn().mockReturnValue(null),
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
    expect(html).not.toContain('AI Dialogue');
    expect(html).not.toContain('AI Translate Options');
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
    expect(
      buildProjectAITranslateStartOptions({ targetBaseline: 'use-current-targets' }),
    ).toEqual({
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
    expect(html).not.toContain('AI Translate Options');
  });
});
