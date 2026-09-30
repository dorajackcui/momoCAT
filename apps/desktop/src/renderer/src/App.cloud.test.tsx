// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudStatus, CloudSyncResult } from '../../shared/cloud';

const state = vi.hoisted(() => ({
  status: {
    configured: true,
    account: { id: 'account', name: 'Translator', email: 'user@example.test' },
  } as CloudStatus,
  guard: vi.fn(async () => true),
  sync: vi.fn(async (): Promise<CloudSyncResult> => ({ changed: false })),
  leave: vi.fn(async () => {}),
  openResources: vi.fn(async () => {}),
  confirm: vi.fn(async () => true),
  error: vi.fn(),
  success: vi.fn(),
  loadProjects: vi.fn(async () => {}),
  closeHandler: undefined as (() => void) | undefined,
  cancelClose: vi.fn(async () => {}),
}));
vi.mock('./components/CloudControls', async (original) => {
  const actual = await original<typeof import('./components/CloudControls')>();
  const { useCallback, useState } = await import('react');
  return {
    ...actual,
    useCloudStatus: () => {
      const [status, setStatus] = useState(state.status);
      const refresh = useCallback(async () => {
        setStatus({ ...state.status });
        return state.status;
      }, []);
      return { status, refresh };
    },
  };
});
vi.mock('./components/WorkspaceSidebar', () => ({
  WorkspaceSidebar: ({
    onOpenCloud,
    onNavigate,
  }: React.ComponentProps<typeof import('./components/WorkspaceSidebar').WorkspaceSidebar>) => (
    <aside>
      <button onClick={() => onOpenCloud?.('project-cloud')}>Open cloud</button>
      <button onClick={() => onNavigate({ kind: 'project', projectId: 1 })}>Open local</button>
      <button onClick={() => onNavigate({ kind: 'tm' })}>Manage TM</button>
      <button onClick={() => onNavigate({ kind: 'settings' })}>Settings</button>
    </aside>
  ),
}));
vi.mock('./components/ProjectDetail', () => ({
  ProjectDetail: ({
    onOpenFile,
    cloud,
  }: React.ComponentProps<typeof import('./components/ProjectDetail').ProjectDetail>) => (
    <div>
      <span>{cloud ? 'Cloud project detail' : 'Local project detail'}</span>
      <button onClick={() => onOpenFile(7)}>Open editor</button>
    </div>
  ),
}));
vi.mock('./components/Editor', async () => {
  const { useEffect } = await import('react');
  return {
    Editor: ({
      registerNavigationGuard,
    }: React.ComponentProps<typeof import('./components/Editor').Editor>) => {
      useEffect(() => registerNavigationGuard?.(state.guard), [registerNavigationGuard]);
      return <div>Editor open</div>;
    },
  };
});
vi.mock('./components/TMManager', () => ({
  TMManager: ({
    storage,
    onStorageChange,
  }: React.ComponentProps<typeof import('./components/TMManager').TMManager>) => (
    <div>
      <span>{storage} TM manager</span>
      <button onClick={() => onStorageChange?.('local')}>Local resources</button>
      <button onClick={() => onStorageChange?.('cloud')}>Cloud resources</button>
    </div>
  ),
}));
vi.mock('./components/TBManager', () => ({ TBManager: () => null }));
vi.mock('./components/SettingsPage', () => ({ SettingsPage: () => <div>Settings page</div> }));
vi.mock('./components/CreateProjectModal', () => ({ CreateProjectModal: () => null }));
vi.mock('./components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./theme/ThemeProvider', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./theme/TypographyProvider', () => ({
  TypographyProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./hooks/aiFileJobs', () => ({ useAIFileJobTracker: () => ({}) }));
vi.mock('./hooks/useAppUpdates', () => ({ useAppUpdates: () => ({}) }));
vi.mock('./hooks/useProjects', () => ({
  useProjects: () => ({
    projects: [],
    loading: false,
    loadProjects: state.loadProjects,
    createProject: vi.fn(),
    deleteProject: vi.fn(),
  }),
}));
vi.mock('./services/FeedbackHost', () => ({ FeedbackHost: () => null }));
vi.mock('./services/feedbackService', () => ({
  feedbackService: { confirm: state.confirm, error: state.error, success: state.success },
}));
import App from './App';

beforeEach(() => {
  vi.clearAllMocks();
  state.closeHandler = undefined;
  state.status = {
    configured: true,
    account: { id: 'account', name: 'Translator', email: 'user@example.test' },
  };
  state.guard.mockImplementation(async () => true);
  state.sync.mockImplementation(async () => ({ changed: false }));
  state.confirm.mockResolvedValue(true);
  state.leave.mockImplementation(async () => {
    state.status = { configured: true, account: state.status.account };
  });
  state.openResources.mockImplementation(async () => {
    state.status = {
      configured: true,
      account: state.status.account,
      context: 'cloud',
      resourceKind: 'tm',
    };
  });
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      cloudStatus: async () => state.status,
      cloudListProjects: async () => [{ id: 'project-cloud', name: 'Product', revision: 1 }],
      cloudOpenProject: async () => {
        state.status = {
          ...state.status,
          context: 'cloud',
          project: {
            id: 'project-cloud',
            projectId: 1,
            name: 'Product',
            revision: 1,
            pending: false,
            writable: true,
          },
        };
        return 1;
      },
      cloudSync: state.sync,
      cloudCancelClose: state.cancelClose,
      cloudLeaveContext: state.leave,
      cloudOpenResources: state.openResources,
      cloudResolveConflict: vi.fn(async () => ({
        changed: true,
        projectId: 1,
        localCopyProjectId: 2,
      })),
      onCloudCloseRequested: (handler: () => void) => {
        state.closeHandler = handler;
        return () => {
          if (state.closeHandler === handler) state.closeHandler = undefined;
        };
      },
    },
  });
});

async function openEditor() {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Open cloud' }));
  await screen.findByText('Cloud project detail');
  fireEvent.click(screen.getByRole('button', { name: 'Open editor' }));
  await screen.findByText('Editor open');
}

describe('cloud workspace navigation and sync', () => {
  it('waits for editor writes before syncing and keeps the editor open after upload', async () => {
    await openEditor();
    let finish!: (value: boolean) => void;
    state.guard.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sync with cloud' }));
    expect(state.sync).not.toHaveBeenCalled();
    expect(screen.getByText('Editor open')).toBeInTheDocument();
    await act(async () => {
      finish(true);
    });
    await waitFor(() => expect(state.sync).toHaveBeenCalledOnce());
    expect(screen.getByText('Editor open')).toBeInTheDocument();
  });

  it('does not upload after an editor save fails', async () => {
    await openEditor();
    state.guard.mockResolvedValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Sync with cloud' }));
    await waitFor(() => expect(state.guard).toHaveBeenCalled());
    expect(state.sync).not.toHaveBeenCalled();
    expect(screen.getByText('Editor open')).toBeInTheDocument();
  });

  it('keeps editing available after a network failure and reports it', async () => {
    await openEditor();
    state.sync.mockRejectedValue(new Error('Offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Sync with cloud' }));
    await waitFor(() => expect(state.error).toHaveBeenCalledWith('Offline'));
    expect(screen.getByText('Editor open')).toBeInTheDocument();
  });

  it('returns to project detail after downloaded data replaces the editor context', async () => {
    await openEditor();
    state.sync.mockResolvedValue({ changed: true, projectId: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Sync with cloud' }));
    await screen.findByText('Cloud project detail');
    expect(screen.queryByText('Editor open')).not.toBeInTheDocument();
  });
  it('refreshes downloaded data even when a later object fails to sync', async () => {
    await openEditor();
    state.sync.mockImplementation(async () => {
      state.status.cacheRevision = 1;
      throw new Error('Later download failed');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sync with cloud' }));
    await screen.findByText('Cloud project detail');
    expect(state.error).toHaveBeenCalledWith('Later download failed');
  });

  it('switches cloud and local resource contexts before rendering their managers', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open cloud' }));
    await screen.findByText('Cloud project detail');
    fireEvent.click(screen.getByRole('button', { name: 'Manage TM' }));
    await screen.findByText('cloud TM manager');
    expect(state.openResources).toHaveBeenCalledWith('tm', true);
    fireEvent.click(screen.getByRole('button', { name: 'Local resources' }));
    await screen.findByText('local TM manager');
    expect(state.leave).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('button', { name: 'Sync with cloud' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cloud resources' }));
    await screen.findByText('cloud TM manager');
  });
});

describe('cloud window close guard', () => {
  it('cancels quit intent when the editor cannot finish saving', async () => {
    await openEditor();
    state.guard.mockResolvedValue(false);
    act(() => state.closeHandler?.());
    await waitFor(() => expect(state.cancelClose).toHaveBeenCalledOnce());
    expect(state.leave).not.toHaveBeenCalled();
  });
  it('offers sync for changes kept in another cloud project', async () => {
    await openEditor();
    state.status.pending = false;
    state.status.pendingElsewhere = true;
    state.sync.mockImplementation(async () => {
      state.status.pendingElsewhere = false;
      return { changed: false };
    });
    act(() => state.closeHandler?.());
    await screen.findByRole('dialog', { name: 'Sync before closing?' });
    fireEvent.click(screen.getByRole('button', { name: 'Sync and close' }));
    await waitFor(() => expect(state.leave).toHaveBeenCalledWith(true, true));
    expect(state.sync).toHaveBeenCalledWith(true);
  });
  it('flushes pending editor writes and closes clean cloud windows without a prompt', async () => {
    await openEditor();
    let finish!: (saved: boolean) => void;
    state.guard.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    act(() => state.closeHandler?.());
    expect(state.leave).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => {
      finish(true);
    });
    await waitFor(() => expect(state.leave).toHaveBeenCalledWith(true, true));
    expect(state.confirm).not.toHaveBeenCalled();
  });

  it('shows one prompt for duplicate close requests and supports cancel', async () => {
    await openEditor();
    state.status.pending = true;
    act(() => {
      state.closeHandler?.();
      state.closeHandler?.();
    });
    await screen.findByRole('dialog', { name: 'Sync before closing?' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.leave).not.toHaveBeenCalled();
    expect(state.sync).not.toHaveBeenCalled();
    expect(screen.getByText('Editor open')).toBeInTheDocument();
    expect(state.cancelClose).toHaveBeenCalledOnce();
  });

  it('can preserve pending work locally and close without uploading', async () => {
    await openEditor();
    state.status.pending = true;
    act(() => state.closeHandler?.());
    await screen.findByRole('dialog', { name: 'Sync before closing?' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep on this device and close' }));
    await waitFor(() => expect(state.leave).toHaveBeenCalledWith(true, true));
    expect(state.sync).not.toHaveBeenCalled();
  });

  it('syncs and verifies completion before closing', async () => {
    await openEditor();
    state.status.pending = true;
    state.sync.mockImplementation(async () => {
      state.status.pending = false;
      return { changed: false };
    });
    act(() => state.closeHandler?.());
    await screen.findByRole('dialog', { name: 'Sync before closing?' });
    fireEvent.click(screen.getByRole('button', { name: 'Sync and close' }));
    await waitFor(() => expect(state.leave).toHaveBeenCalledWith(true, true));
    expect(state.sync).toHaveBeenCalledOnce();
    expect(state.sync).toHaveBeenCalledWith(true);
    expect(state.sync.mock.invocationCallOrder[0]).toBeLessThan(
      state.leave.mock.invocationCallOrder[0],
    );
  });

  it('leaves the window open when syncing fails', async () => {
    await openEditor();
    state.status.pending = true;
    state.sync.mockRejectedValue(new Error('Offline'));
    act(() => state.closeHandler?.());
    await screen.findByRole('dialog', { name: 'Sync before closing?' });
    fireEvent.click(screen.getByRole('button', { name: 'Sync and close' }));
    await waitFor(() => expect(state.error).toHaveBeenCalledWith('Offline'));
    expect(state.leave).not.toHaveBeenCalled();
    expect(screen.getByText('Editor open')).toBeInTheDocument();
  });

  it('keeps the window open if successful upload still leaves changes pending', async () => {
    await openEditor();
    state.status.pending = true;
    act(() => state.closeHandler?.());
    await screen.findByRole('dialog', { name: 'Sync before closing?' });
    fireEvent.click(screen.getByRole('button', { name: 'Sync and close' }));
    await waitFor(() =>
      expect(state.error).toHaveBeenCalledWith(
        'Some changes could not be synced. Your work remains on this device.',
      ),
    );
    expect(state.leave).not.toHaveBeenCalled();
  });
});

describe('settings route', () => {
  it('detaches cloud resources before opening global settings', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open cloud' }));
    await screen.findByText('Cloud project detail');
    fireEvent.click(screen.getByRole('button', { name: 'Manage TM' }));
    await screen.findByText('cloud TM manager');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByText('Settings page');
    expect(state.leave).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('button', { name: 'Sync with cloud' })).not.toBeInTheDocument();
  });
});
