import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PastedSourceFileInput } from '../../../../shared/ipc';
import { readClipboardContentForPaste, useProjectFileImport } from './useProjectFileImport';

const { apiClientMock, feedbackServiceMock } = vi.hoisted(() => ({
  apiClientMock: {
    openFileDialog: vi.fn(),
    getFilePreview: vi.fn(),
    addFileToProject: vi.fn(),
    readClipboard: vi.fn(),
    createPastedSourceFile: vi.fn(),
  },
  feedbackServiceMock: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../../services/apiClient', () => ({ apiClient: apiClientMock }));
vi.mock('../../services/feedbackService', () => ({ feedbackService: feedbackServiceMock }));

beforeEach(() => {
  vi.clearAllMocks();
  apiClientMock.openFileDialog.mockResolvedValue(null);
  apiClientMock.getFilePreview.mockResolvedValue([]);
  apiClientMock.addFileToProject.mockResolvedValue(undefined);
  apiClientMock.readClipboard.mockResolvedValue({ text: 'Clipboard source', html: '' });
  apiClientMock.createPastedSourceFile.mockResolvedValue({ id: 1 });
});

describe('useProjectFileImport paste source orchestration', () => {
  it('guards duplicate paste confirmation while creation is in flight', async () => {
    const createDeferred = createDeferredPromise();
    const loadData = vi.fn().mockResolvedValue(undefined);
    const runMutation = vi.fn(async <T>(fn: () => Promise<T>) => fn());
    apiClientMock.createPastedSourceFile.mockReturnValue(createDeferred.promise);

    const result = renderImportHook({ loadData, runMutation });

    await result.openPasteSource();

    const input: PastedSourceFileInput = { sources: ['A'], tagPolicy: 'default' };

    const first = result.confirmPasteSource(input);
    const second = result.confirmPasteSource(input);
    createDeferred.resolve(undefined);
    await Promise.all([first, second]);

    expect(apiClientMock.createPastedSourceFile).toHaveBeenCalledTimes(1);
    expect(apiClientMock.createPastedSourceFile).toHaveBeenCalledWith(42, input);
    expect(loadData).toHaveBeenCalledTimes(1);
    expect(feedbackServiceMock.success).toHaveBeenCalledWith('File created from pasted source');
  });

  it('opens paste source with empty clipboard content when clipboard read rejects', async () => {
    apiClientMock.readClipboard.mockRejectedValue(new Error('clipboard unavailable'));

    await expect(readClipboardContentForPaste(apiClientMock.readClipboard)).resolves.toEqual({
      text: '',
      html: '',
    });
  });
});

function renderImportHook({
  loadData,
  runMutation,
}: {
  loadData: () => Promise<void>;
  runMutation: <T>(fn: () => Promise<T>) => Promise<T>;
}) {
  let hookResult: ReturnType<typeof useProjectFileImport> | null = null;

  renderToStaticMarkup(
    React.createElement(() => {
      hookResult = useProjectFileImport({
        projectId: 42,
        loadData,
        runMutation,
      });
      return null;
    }),
  );

  if (!hookResult) {
    throw new Error('Failed to capture useProjectFileImport result');
  }

  return hookResult;
}

function createDeferredPromise() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
