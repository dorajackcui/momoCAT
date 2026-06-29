import { describe, expect, it, vi } from 'vitest';
import type { ProjectService } from '../services/ProjectService';
import type { JobManager } from '../JobManager';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { registerProjectHandlers } from './projectHandlers';
import { registerTMHandlers } from './tmHandlers';
import { registerTBHandlers } from './tbHandlers';
import { registerAIHandlers } from './aiHandlers';
import { registerDialogHandlers } from './dialogHandlers';
import { registerClipboardHandlers } from './clipboardHandlers';
import type { IpcMainListener } from './types';

describe('IPC handler registration smoke', () => {
  it('registers all domain channels via modular handlers', () => {
    const handle = vi.fn();
    const ipcMain = { handle };
    const projectService = {} as ProjectService;
    const jobManager = {} as JobManager;
    const clipboard = {
      readText: vi.fn(),
      readHTML: vi.fn(),
    };

    registerProjectHandlers({ ipcMain, projectService });
    registerTMHandlers({ ipcMain, projectService, jobManager });
    registerTBHandlers({ ipcMain, projectService, jobManager });
    registerAIHandlers({ ipcMain, projectService, jobManager });
    registerDialogHandlers({
      ipcMain,
      dialog: {
        showOpenDialog: vi.fn(),
        showSaveDialog: vi.fn(),
      },
    });
    registerClipboardHandlers({ ipcMain, clipboard });

    const registeredChannels = new Set(handle.mock.calls.map((call) => call[0] as string));

    const expectedChannels = [
      ...Object.values(IPC_CHANNELS.project),
      ...Object.values(IPC_CHANNELS.file),
      ...Object.values(IPC_CHANNELS.segment),
      ...Object.values(IPC_CHANNELS.tm),
      ...Object.values(IPC_CHANNELS.tb),
      ...Object.values(IPC_CHANNELS.ai),
      ...Object.values(IPC_CHANNELS.dialog),
      ...Object.values(IPC_CHANNELS.clipboard),
    ];

    expect(registeredChannels.size).toBe(expectedChannels.length);
    expectedChannels.forEach((channel) => {
      expect(registeredChannels.has(channel)).toBe(true);
    });
  });

  it('delegates file inspect requests to the project service with the selected output path', async () => {
    const handlers = new Map<string, IpcMainListener>();
    const handle = vi.fn((channel: string, listener: IpcMainListener) => {
      handlers.set(channel, listener);
    });
    const inspectResult = {
      outputPath: 'inspect.xlsx',
      jsonOutputPath: 'inspect.json',
      summary: { total: 3, ready: 2, error: 1 },
    };
    const inspectFile = vi.fn().mockResolvedValue(inspectResult);
    const projectService = { inspectFile } as unknown as ProjectService;

    registerProjectHandlers({ ipcMain: { handle }, projectService });

    const handler = handlers.get(IPC_CHANNELS.file.inspect);
    expect(handler).toBeDefined();

    await expect(handler?.({}, 7, 'inspect.xlsx')).resolves.toBe(inspectResult);
    expect(inspectFile).toHaveBeenCalledWith(7, 'inspect.xlsx');
  });
});
