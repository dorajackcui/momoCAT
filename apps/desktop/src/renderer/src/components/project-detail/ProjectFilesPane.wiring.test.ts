import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AIBatchTargetBaseline, ProjectFileRecord } from '../../../../shared/ipc';
import type { ProjectAIController } from '../../hooks/projectDetail/useProjectAI';

const hookMocks = vi.hoisted(() => ({
  useState: vi.fn(),
  setAiTranslateFile: vi.fn(),
}));

const modalMock = vi.hoisted(() => ({
  onConfirm: undefined as
    | ((options: { targetBaseline: AIBatchTargetBaseline }) => void)
    | undefined,
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    default: actual,
    useState: hookMocks.useState,
  };
});

vi.mock('./ProjectAIPane', () => ({
  ProjectAIPane: () => React.createElement('div', { 'data-testid': 'project-ai-pane' }),
}));

vi.mock('./ProjectAITranslateModal', () => ({
  ProjectAITranslateModal: (props: {
    onConfirm: (options: { targetBaseline: AIBatchTargetBaseline }) => void;
  }) => {
    modalMock.onConfirm = props.onConfirm;
    return React.createElement('div', null, 'mock translate modal');
  },
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

function createAIControllerMock(): {
  ai: ProjectAIController;
  startAITranslateFile: ReturnType<typeof vi.fn>;
} {
  const startAITranslateFile = vi.fn().mockResolvedValue(undefined);
  const ai = {
    providerOptions: [],
    modelDraft: '',
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
  } as unknown as ProjectAIController;

  return { ai, startAITranslateFile };
}

describe('ProjectFilesPane wiring', () => {
  it('forwards selected modal target baseline to the AI file translate action', async () => {
    hookMocks.useState.mockReturnValue([{ id: 1, name: 'demo.xlsx' }, hookMocks.setAiTranslateFile]);
    const { ai, startAITranslateFile } = createAIControllerMock();
    const { ProjectFilesPane } = await import('./ProjectFilesPane');

    renderToStaticMarkup(
      React.createElement(ProjectFilesPane, {
        files: [createFile()],
        onOpenFile: vi.fn(),
        onOpenCommitModal: vi.fn(),
        onOpenMatchModal: vi.fn(),
        onDeleteFile: vi.fn().mockResolvedValue(undefined),
        onExportFile: vi.fn().mockResolvedValue(undefined),
        onRunFileQA: vi.fn().mockResolvedValue(undefined),
        ai,
        projectType: 'translation',
      }),
    );

    modalMock.onConfirm?.({ targetBaseline: 'ignore-current-targets' });

    expect(startAITranslateFile).toHaveBeenCalledWith(1, 'demo.xlsx', {
      targetBaseline: 'ignore-current-targets',
      confirm: false,
    });
    expect(hookMocks.setAiTranslateFile).toHaveBeenCalledWith(null);
  });
});
