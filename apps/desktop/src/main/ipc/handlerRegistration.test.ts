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
import { registerJobHandlers } from './jobHandlers';
import { registerSystemHandlers } from './systemHandlers';
import type { IpcMainListener } from './types';

describe('IPC handler registration smoke', () => {
  it('registers all domain channels via modular handlers', () => {
    const handle = vi.fn();
    const ipcMain = { handle };
    const projectService = {} as ProjectService;
    const jobManager = {} as JobManager;
    const referenceLookup = {
      findTmMatches: vi.fn(),
      findTbMatches: vi.fn(),
      searchConcordance: vi.fn(),
    };
    const notifyReferenceDataChanged = vi.fn();
    const clipboard = {
      readText: vi.fn(),
      readHTML: vi.fn(),
    };

    registerProjectHandlers({ ipcMain, projectService });
    registerTMHandlers({
      ipcMain,
      projectService,
      jobManager,
      referenceLookup,
      notifyReferenceDataChanged,
    });
    registerTBHandlers({
      ipcMain,
      projectService,
      jobManager,
      referenceLookup,
      notifyReferenceDataChanged,
    });
    registerAIHandlers({ ipcMain, projectService, jobManager });
    registerDialogHandlers({
      ipcMain,
      dialog: {
        showOpenDialog: vi.fn(),
        showSaveDialog: vi.fn(),
      },
    });
    registerClipboardHandlers({ ipcMain, clipboard });
    registerJobHandlers({ ipcMain, jobManager });
    registerSystemHandlers({ ipcMain, shell: { openPath: vi.fn() } });

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
      ...Object.values(IPC_CHANNELS.job),
      ...Object.values(IPC_CHANNELS.system),
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

  it('delegates reference export requests to the project service with the selected output path', async () => {
    const handlers = new Map<string, IpcMainListener>();
    const handle = vi.fn((channel: string, listener: IpcMainListener) => {
      handlers.set(channel, listener);
    });
    const exportResult = {
      outputPath: 'references.xlsx',
      summary: { total: 3, ready: 2, error: 1 },
    };
    const exportReferencesForMt = vi.fn().mockResolvedValue(exportResult);
    const projectService = { exportReferencesForMt } as unknown as ProjectService;

    registerProjectHandlers({ ipcMain: { handle }, projectService });

    const handler = handlers.get(IPC_CHANNELS.file.exportReferences);
    expect(handler).toBeDefined();

    await expect(handler?.({}, 7, 'references.xlsx')).resolves.toBe(exportResult);
    expect(exportReferencesForMt).toHaveBeenCalledWith(7, 'references.xlsx');
  });

  it('delegates source terminology precheck requests with the selected output path', async () => {
    const handlers = new Map<string, IpcMainListener>();
    const handle = vi.fn((channel: string, listener: IpcMainListener) => {
      handlers.set(channel, listener);
    });
    const precheckResult = {
      outputPath: 'source-terms.xlsx',
      summary: { total: 3, ready: 3, error: 0, cancelled: 0, uniqueTerms: 5 },
    };
    const precheckSourceTerminology = vi.fn().mockResolvedValue(precheckResult);
    const cancelSourceTerminologyPrecheck = vi.fn().mockReturnValue(true);
    const projectService = {
      precheckSourceTerminology,
      cancelSourceTerminologyPrecheck,
    } as unknown as ProjectService;

    registerProjectHandlers({ ipcMain: { handle }, projectService });

    const handler = handlers.get(IPC_CHANNELS.file.precheckSourceTerminology);
    expect(handler).toBeDefined();
    await expect(handler?.({}, 7, 'source-terms.xlsx')).resolves.toBe(precheckResult);
    expect(precheckSourceTerminology).toHaveBeenCalledWith(7, 'source-terms.xlsx');

    const cancelHandler = handlers.get(IPC_CHANNELS.file.cancelSourceTerminologyPrecheck);
    expect(cancelHandler).toBeDefined();
    expect(cancelHandler?.({}, 7)).toBe(true);
    expect(cancelSourceTerminologyPrecheck).toHaveBeenCalledWith(7);
  });
});
