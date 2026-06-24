type MessageBoxOptions = {
  type: 'info' | 'error';
  buttons: string[];
  defaultId?: number;
  cancelId?: number;
  title: string;
  message: string;
  detail?: string;
  noLink?: boolean;
};

type DialogLike = {
  showMessageBox(options: MessageBoxOptions): Promise<{ response: number }>;
};

type AppLike = {
  isPackaged: boolean;
  getVersion(): string;
};

type LoggerLike = {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
};

type UpdaterLike = {
  autoDownload: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
  on(event: string, listener: (...args: unknown[]) => void | Promise<void>): unknown;
};

export type CheckForUpdatesOptions = {
  notifyNoUpdate?: boolean;
};

export type AppUpdateService = {
  enabled: boolean;
  checkForUpdates(options?: CheckForUpdatesOptions): Promise<void>;
};

export type AppUpdateServiceOptions = {
  appName: string;
  app: AppLike;
  dialog: DialogLike;
  isDev: boolean;
  logger: LoggerLike;
  updater: UpdaterLike;
};

function updateVersionLabel(info: unknown): string {
  if (typeof info !== 'object' || info === null || !('version' in info)) {
    return 'the latest version';
  }

  const { version } = info as { version: unknown };
  return typeof version === 'string' && version.trim() ? version : 'the latest version';
}

export function createAppUpdateService(options: AppUpdateServiceOptions): AppUpdateService {
  const { app, appName, dialog, isDev, logger, updater } = options;
  const enabled = !isDev && app.isPackaged;
  let manualCheckPending = false;

  async function showManualCheckFailed(error: unknown) {
    logger.error('[Updates] Failed to check for updates:', error);
    await dialog.showMessageBox({
      type: 'error',
      buttons: ['OK'],
      defaultId: 0,
      title: 'Update Check Failed',
      message: `Could not check for ${appName} updates.`,
      detail: 'Please check your network connection and try again later.',
      noLink: true,
    });
  }

  if (enabled) {
    updater.autoDownload = true;

    updater.on('checking-for-update', () => {
      logger.info(`[Updates] Checking for ${appName} updates from version ${app.getVersion()}.`);
    });

    updater.on('update-available', (info) => {
      logger.info(`[Updates] Update available: ${updateVersionLabel(info)}.`);
    });

    updater.on('update-not-available', async () => {
      if (!manualCheckPending) return;
      manualCheckPending = false;

      await dialog.showMessageBox({
        type: 'info',
        buttons: ['OK'],
        defaultId: 0,
        title: 'No Updates Available',
        message: `${appName} is up to date.`,
        noLink: true,
      });
    });

    updater.on('update-downloaded', async (info) => {
      manualCheckPending = false;
      const version = updateVersionLabel(info);
      const result = await dialog.showMessageBox({
        type: 'info',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Update Ready',
        message: `${appName} ${version} is ready to install.`,
        detail: `Restart ${appName} to finish installing the update.`,
        noLink: true,
      });

      if (result.response === 0) {
        updater.quitAndInstall();
      }
    });

    updater.on('error', async (error) => {
      const shouldNotify = manualCheckPending;
      manualCheckPending = false;

      if (shouldNotify) {
        await showManualCheckFailed(error);
        return;
      }

      logger.error('[Updates] Background update check failed:', error);
    });
  }

  return {
    enabled,
    async checkForUpdates(checkOptions = {}) {
      if (!enabled) {
        if (checkOptions.notifyNoUpdate) {
          logger.warn('[Updates] Skipping update check outside a packaged production build.');
        }
        return;
      }

      manualCheckPending = checkOptions.notifyNoUpdate === true;

      try {
        await updater.checkForUpdates();
      } catch (error) {
        const shouldNotify = manualCheckPending;
        manualCheckPending = false;

        if (shouldNotify) {
          await showManualCheckFailed(error);
          return;
        }

        logger.error('[Updates] Background update check failed:', error);
      }
    },
  };
}
