import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron';
import { join } from 'path';
import { mkdir, readFile } from 'fs/promises';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { CATDatabase, UnsupportedDatabaseSchemaError } from '@cat/db';
import { ProjectService } from './services/ProjectService';
import { JobManager } from './JobManager';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import { registerProjectHandlers } from './ipc/projectHandlers';
import { registerTMHandlers } from './ipc/tmHandlers';
import { registerTBHandlers } from './ipc/tbHandlers';
import { registerAIHandlers } from './ipc/aiHandlers';
import { registerDialogHandlers } from './ipc/dialogHandlers';

// Disable hardware acceleration to avoid crashes in some environments
app.disableHardwareAcceleration();

// Add switches to disable sandbox and gpu for stability
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

// Set UserData path early to avoid permission issues with Chromium cache
const userDataPath = is.dev ? join(app.getAppPath(), '../../.cat_data') : app.getPath('userData');

if (is.dev) {
  app.setPath('userData', userDataPath);
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

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.cat.tool');

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // DB & Services
  const dbPath = join(userDataPath, 'cat_v1.db');
  const projectsDir = join(userDataPath, 'projects');
  const proxyEnvPath = join(userDataPath, 'proxy.env');
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
  const projectService = new ProjectService(db, projectsDir, dbPath);
  const jobManager = new JobManager();

  registerProjectHandlers({ ipcMain, projectService });
  registerTMHandlers({ ipcMain, projectService, jobManager });
  registerTBHandlers({ ipcMain, projectService, jobManager });
  registerAIHandlers({ ipcMain, projectService, jobManager });
  registerDialogHandlers({ ipcMain, dialog });

  // Listen for progress updates and broadcast to all windows
  projectService.onProgress((data) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(IPC_CHANNELS.events.appProgress, data);
    });
  });

  // Listen for segment updates and broadcast to all windows
  projectService.onSegmentsUpdated((data) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(IPC_CHANNELS.events.segmentsUpdated, data);
    });
  });

  // IPC: Job Management
  jobManager.on('progress', (progress) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(IPC_CHANNELS.events.jobProgress, progress);
    });
  });

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
