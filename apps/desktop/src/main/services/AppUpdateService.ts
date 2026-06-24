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

type DownloadProgressInfo = {
  percent?: unknown;
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
  notifyStatus?: (status: {
    phase: 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error';
    message: string;
    version?: string;
    percent?: number;
  }) => void;
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
  const { app, appName, dialog, isDev, logger, notifyStatus, updater } = options;
  const enabled = !isDev && app.isPackaged;
  let manualCheckPending = false;

  function emitStatus(status: Parameters<NonNullable<typeof notifyStatus>>[0]) {
    notifyStatus?.(status);
  }

  function downloadPercent(info: unknown): number | undefined {
    if (typeof info !== 'object' || info === null || !('percent' in info)) {
      return undefined;
    }

    const { percent } = info as DownloadProgressInfo;
    return typeof percent === 'number' && Number.isFinite(percent)
      ? Math.max(0, Math.min(100, Math.round(percent)))
      : undefined;
  }

  async function showManualCheckFailed(error: unknown) {
    logger.error('[Updates] Failed to check for updates:', error);
    emitStatus({
      phase: 'error',
      message: 'Update check failed.',
    });
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
      emitStatus({
        phase: 'checking',
        message: 'Checking for updates...',
      });
    });

    updater.on('update-available', (info) => {
      const version = updateVersionLabel(info);
      logger.info(`[Updates] Update available: ${version}.`);
      emitStatus({
        phase: 'available',
        message: `Update ${version} found. Downloading...`,
        version,
      });
    });

    updater.on('download-progress', (info) => {
      const percent = downloadPercent(info);
      const suffix = percent === undefined ? '' : ` ${percent}%`;
      emitStatus({
        phase: 'downloading',
        message: `Downloading update${suffix}...`,
        percent,
      });
    });

    updater.on('update-not-available', async () => {
      emitStatus({
        phase: 'not-available',
        message: `${appName} is up to date.`,
      });

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
      emitStatus({
        phase: 'downloaded',
        message: `Update ${version} downloaded. Restart to install.`,
        version,
      });
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

      emitStatus({
        phase: 'error',
        message: 'Background update check failed.',
      });
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
        emitStatus({
          phase: 'not-available',
          message: 'Update checks are available in installed builds.',
        });
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

        emitStatus({
          phase: 'error',
          message: 'Background update check failed.',
        });
        logger.error('[Updates] Background update check failed:', error);
      }
    },
  };
}
