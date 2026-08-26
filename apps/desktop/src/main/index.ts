import { app, shell, BrowserWindow, ipcMain, dialog, clipboard, Menu } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { join } from 'path';
import { mkdir, readFile } from 'fs/promises';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import electronUpdater from 'electron-updater';
import { CATDatabase, UnsupportedDatabaseSchemaError } from '@cat/db';
import { AIRuntimeConfigService } from '@cat/localization';
import { ProjectService } from './services/ProjectService';
import { JobManager } from './JobManager';
import { createAppUpdateService, type AppUpdateService } from './services/AppUpdateService';
import type { AppUpdateStatusEvent, ReferenceDataChangedEvent } from '../shared/ipc';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import { SegmentUpdateBatcher } from './ipc/SegmentUpdateBatcher';
import { ReferenceLookupWorkerManager } from './services/referenceLookup/ReferenceLookupWorkerManager';
import {
  shouldInvalidateReferenceLookupWorkerCaches,
  subscribeToWorkingTMReferenceDataChanges,
} from './referenceDataInvalidation';
import {
  AI_PROMPT_DEBUG_ENV,
  AI_PROMPT_DEBUG_FILE_ENV,
  isAIPromptDebugEnabled,
} from './services/modules/ai/promptDebug';
import {
  AI_BATCH_DEBUG_ENV,
  AI_BATCH_DEBUG_FILE_ENV,
  isAIBatchDebugEnabled,
} from './services/modules/ai/aiBatchDebug';
import {
  CAT_TRANSLATION_AUDIT_ENV,
  createTranslationAuditDebugSink,
} from './services/modules/ai/translationAuditDebug';
import { registerProjectHandlers } from './ipc/projectHandlers';
import { registerTMHandlers } from './ipc/tmHandlers';
import { registerTBHandlers } from './ipc/tbHandlers';
import { registerAIHandlers } from './ipc/aiHandlers';
import { registerDialogHandlers } from './ipc/dialogHandlers';
import { registerClipboardHandlers } from './ipc/clipboardHandlers';
import { registerJobHandlers } from './ipc/jobHandlers';
import { registerSystemHandlers } from './ipc/systemHandlers';
import { focusPrimaryWindow } from './singleInstance';
import { resolveDesktopUserDataPath } from './userDataPath';

const { autoUpdater } = electronUpdater;

// Disable hardware acceleration to avoid crashes in some environments
app.disableHardwareAcceleration();

// Add switches to disable sandbox and gpu for stability
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

// Set UserData path early to avoid permission issues with Chromium cache
const userDataPath = resolveDesktopUserDataPath({
  appPath: app.getAppPath(),
  defaultUserDataPath: app.getPath('userData'),
  isDev: is.dev,
});
app.setPath('userData', userDataPath);

const primaryInstanceReady = app.requestSingleInstanceLock() ? app.whenReady() : null;
if (!primaryInstanceReady) {
  app.quit();
} else {
  app.on('second-instance', () => {
    focusPrimaryWindow(BrowserWindow.getAllWindows());
  });
}

async function loadProxyEnvFromFile(filePath: string) {
  let content = '';
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return;
    }
    throw error;
  }

  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const index = normalized.indexOf('=');
    if (index <= 0) return;

    const key = normalized.slice(0, index).trim();
    const value = normalized.slice(index + 1).trim();
    if (!key) return;

    process.env[key] = value;
  });
}

function setupProxy() {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  if (!proxyUrl) return;
  try {
    const agent = new ProxyAgent(proxyUrl);
    setGlobalDispatcher(agent);
    console.log(`[Proxy] Enabled via ${proxyUrl}`);
  } catch (error) {
    console.error('[Proxy] Failed to initialize proxy agent:', error);
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function createEditMenu(): MenuItemConstructorOptions {
  return {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  };
}

function createViewMenu(): MenuItemConstructorOptions {
  return {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  };
}

function createCheckForUpdatesMenuItem(
  updateService: AppUpdateService,
): MenuItemConstructorOptions {
  return {
    label: 'Check for Updates',
    enabled: updateService.enabled,
    click: () => {
      void updateService.checkForUpdates({ notifyNoUpdate: true });
    },
  };
}

function configureApplicationMenu(updateService: AppUpdateService) {
  const checkForUpdatesItem = createCheckForUpdatesMenuItem(updateService);
  const template: MenuItemConstructorOptions[] =
    process.platform === 'darwin'
      ? [
          {
            label: 'momoCAT',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              checkForUpdatesItem,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
          createEditMenu(),
          createViewMenu(),
          {
            label: 'Window',
            submenu: [{ role: 'minimize' }, { role: 'zoom' }],
          },
        ]
      : [
          {
            label: 'File',
            submenu: [checkForUpdatesItem, { type: 'separator' }, { role: 'quit' }],
          },
          createEditMenu(),
          createViewMenu(),
        ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function broadcastAppUpdateStatus(status: AppUpdateStatusEvent) {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(IPC_CHANNELS.events.appUpdateStatus, status);
  });
}

function broadcastReferenceDataChanged(event: ReferenceDataChangedEvent) {
  BrowserWindow.getAllWindows().forEach((win) => {
    try {
      win.webContents.send(IPC_CHANNELS.events.referenceDataChanged, event);
    } catch (error) {
      console.error('[ReferenceData] Failed to notify renderer:', error);
    }
  });
}

primaryInstanceReady?.then(async () => {
  electronApp.setAppUserModelId('com.cat.tool');

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // DB & Services
  const dbPath = join(userDataPath, 'cat_v1.db');
  const projectsDir = join(userDataPath, 'projects');
  const proxyEnvPath = join(userDataPath, 'proxy.env');
  const aiRuntimeConfigPath = join(userDataPath, 'ai-runtime.json');
  const fallbackProxyEnvPath = join(app.getAppPath(), 'proxy.env');

  try {
    await mkdir(userDataPath, { recursive: true });
    await mkdir(projectsDir, { recursive: true });
  } catch (e) {
    console.error('Failed to prepare directories:', e);
  }

  console.log('UserData Path:', userDataPath);
  console.log('DB Path:', dbPath);
  await loadProxyEnvFromFile(proxyEnvPath);
  await loadProxyEnvFromFile(fallbackProxyEnvPath);
  if (isAIPromptDebugEnabled()) {
    if (!process.env[AI_PROMPT_DEBUG_FILE_ENV]) {
      process.env[AI_PROMPT_DEBUG_FILE_ENV] = join(userDataPath, 'ai_prompt_debug.log');
    }
    console.log(`[AIPromptDebug] Enabled via ${AI_PROMPT_DEBUG_ENV}`);
    console.log(`[AIPromptDebug] UTF-8 prompt log: ${process.env[AI_PROMPT_DEBUG_FILE_ENV]}`);
  }
  if (isAIBatchDebugEnabled()) {
    if (!process.env[AI_BATCH_DEBUG_FILE_ENV]) {
      process.env[AI_BATCH_DEBUG_FILE_ENV] = join(userDataPath, 'ai_batch_translate_debug.log');
    }
    console.log(`[AIBatchDebug] Enabled via ${AI_BATCH_DEBUG_ENV} or ${AI_PROMPT_DEBUG_ENV}`);
    console.log(`[AIBatchDebug] UTF-8 batch log: ${process.env[AI_BATCH_DEBUG_FILE_ENV]}`);
  }
  const translationAudit = createTranslationAuditDebugSink(userDataPath);
  if (translationAudit) {
    console.log(`[TranslationAudit] Enabled via ${CAT_TRANSLATION_AUDIT_ENV}`);
    console.log(`[TranslationAudit] JSONL audit log: ${translationAudit.filePath}`);
  }
  setupProxy();

  let db: CATDatabase;
  try {
    db = new CATDatabase(dbPath);
  } catch (err) {
    console.error('Failed to initialize database:', err);
    if (err instanceof UnsupportedDatabaseSchemaError) {
      await dialog.showMessageBox({
        type: 'error',
        buttons: ['Exit'],
        defaultId: 0,
        title: 'Unsupported Database Schema',
        message: 'This database was created by an unsupported older version of the app.',
        detail: `The current app only supports the current schema marker and will not auto-migrate old data.\n\nDatabase path: ${dbPath}\n\nPlease rebuild the local database or re-import your project data into a fresh workspace.`,
        noLink: true,
      });
      app.exit(1);
      return;
    }
    throw err;
  }
  const aiRuntimeConfigService = new AIRuntimeConfigService(aiRuntimeConfigPath);
  await aiRuntimeConfigService.initialize();

  const projectService = new ProjectService(db, projectsDir, dbPath, {
    aiRuntimeConfigProvider: aiRuntimeConfigService,
    translationAuditSink: translationAudit?.sink,
  });
  const jobManager = new JobManager();
  const referenceLookup = new ReferenceLookupWorkerManager({ dbPath });
  const referenceLookupPrefetch = new ReferenceLookupWorkerManager({ dbPath });
  void referenceLookup.warmUp();
  void referenceLookupPrefetch.warmUp();
  app.on('before-quit', () => {
    void referenceLookup.dispose();
    void referenceLookupPrefetch.dispose();
  });

  // TM/TB mutations happen on the main-process DB connection; the lookup
  // workers keep their own connection plus in-process caches (English TB
  // recognizer keyed by a per-connection data version). Invalidate them
  // alongside the renderer broadcast or warmed workers keep serving stale terms.
  const notifyReferenceDataChanged = (event: ReferenceDataChangedEvent) => {
    if (shouldInvalidateReferenceLookupWorkerCaches(event)) {
      void referenceLookup.invalidateReferenceData().catch((error) => {
        console.error('[ReferenceLookup] Failed to invalidate worker caches:', error);
      });
      void referenceLookupPrefetch.invalidateReferenceData().catch((error) => {
        console.error('[ReferenceLookup] Failed to invalidate prefetch worker caches:', error);
      });
    }
    broadcastReferenceDataChanged(event);
  };
  const unsubscribeWorkingTMReferenceDataChanges = subscribeToWorkingTMReferenceDataChanges(
    projectService,
    notifyReferenceDataChanged,
  );
  app.on('before-quit', unsubscribeWorkingTMReferenceDataChanges);

  registerProjectHandlers({ ipcMain, projectService });
  registerTMHandlers({
    ipcMain,
    projectService,
    jobManager,
    referenceLookup,
    referenceLookupPrefetch,
    notifyReferenceDataChanged,
  });
  registerTBHandlers({
    ipcMain,
    projectService,
    jobManager,
    referenceLookup,
    referenceLookupPrefetch,
    notifyReferenceDataChanged,
  });
  registerAIHandlers({ ipcMain, projectService, jobManager });
  registerDialogHandlers({ ipcMain, dialog });
  registerClipboardHandlers({ ipcMain, clipboard });
  registerJobHandlers({ ipcMain, jobManager });
  registerSystemHandlers({ ipcMain, shell });

  const appUpdateService = createAppUpdateService({
    appName: 'momoCAT',
    app,
    dialog,
    isDev: is.dev,
    logger: console,
    notifyStatus: broadcastAppUpdateStatus,
    updater: autoUpdater,
  });
  configureApplicationMenu(appUpdateService);
  ipcMain.handle(IPC_CHANNELS.app.checkForUpdates, async () => {
    await appUpdateService.checkForUpdates();
  });

  // Listen for progress updates and broadcast to all windows
  projectService.onProgress((data) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(IPC_CHANNELS.events.appProgress, data);
    });
  });

  // Listen for segment updates and broadcast to all windows (batched)
  const segmentUpdateBatcher = new SegmentUpdateBatcher();
  projectService.onSegmentsUpdated((data) => {
    segmentUpdateBatcher.enqueue(data);
  });

  // IPC: Job Management
  jobManager.on('progress', (progress) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(IPC_CHANNELS.events.jobProgress, progress);
    });
  });

  createWindow();
  void appUpdateService.checkForUpdates();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
