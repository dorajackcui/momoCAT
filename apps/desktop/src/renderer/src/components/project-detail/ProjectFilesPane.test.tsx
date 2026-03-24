import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectAIController } from '../../hooks/projectDetail/useProjectAI';
import type { ProjectFileRecord } from '../../../../shared/ipc';
import { ProjectFilesPane } from './ProjectFilesPane';

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
    modelDraft: 'gpt-4o',
    setModelDraft: vi.fn(),
    promptDraft: '',
    setPromptDraft: vi.fn(),
    temperatureDraft: '0.2',
    setTemperatureDraft: vi.fn(),
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
    hasInvalidTemperature: false,
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
  return render(
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
  it('shows a single AI Translate button and opens options modal in translation projects', () => {
    const { ai } = createAIControllerMock();
    renderPane(ai, 'translation');

    expect(screen.getByText('AI Translate')).toBeInTheDocument();
    expect(screen.queryByText('AI Dialogue')).toBeNull();

    fireEvent.click(screen.getByText('AI Translate'));
    expect(screen.getByText('AI Translate Options')).toBeInTheDocument();
    expect(screen.getByLabelText('Translation Scope')).toBeInTheDocument();
    expect(screen.getByLabelText('Dialogue Mode')).toBeInTheDocument();
  });

  it('submits default modal options as blank-only + default mode without extra confirm', () => {
    const { ai, startAITranslateFile } = createAIControllerMock();
    renderPane(ai, 'translation');

    fireEvent.click(screen.getByText('AI Translate'));
    fireEvent.click(screen.getByText('Start AI Translate'));

    expect(startAITranslateFile).toHaveBeenCalledWith(1, 'demo.xlsx', {
      mode: 'default',
      targetScope: 'blank-only',
      confirm: false,
    });
  });

  it('submits selected dialogue + overwrite options from modal', () => {
    const { ai, startAITranslateFile } = createAIControllerMock();
    renderPane(ai, 'translation');

    fireEvent.click(screen.getByText('AI Translate'));
    fireEvent.change(screen.getByLabelText('Translation Scope'), {
      target: { value: 'overwrite-non-confirmed' },
    });
    fireEvent.change(screen.getByLabelText('Dialogue Mode'), {
      target: { value: 'dialogue' },
    });
    fireEvent.click(screen.getByText('Start AI Translate'));

    expect(startAITranslateFile).toHaveBeenCalledWith(1, 'demo.xlsx', {
      mode: 'dialogue',
      targetScope: 'overwrite-non-confirmed',
      confirm: false,
    });
  });

  it('keeps one-click AI action for non-translation projects', () => {
    const { ai, startAITranslateFile } = createAIControllerMock();
    renderPane(ai, 'review');

    fireEvent.click(screen.getByText('AI Review'));
    expect(screen.queryByText('AI Translate Options')).toBeNull();
    expect(startAITranslateFile).toHaveBeenCalledWith(1, 'demo.xlsx');
  });
});
