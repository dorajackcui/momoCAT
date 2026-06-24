import { describe, expect, it, vi } from 'vitest';
import { createAppUpdateService } from './AppUpdateService';

function createFixture(options: { isDev?: boolean; isPackaged?: boolean } = {}) {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const showMessageBox = vi.fn(async () => ({ response: 0 }));
  const updater = {
    autoDownload: false,
    checkForUpdates: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
      return updater;
    }),
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const service = createAppUpdateService({
    appName: 'momoCAT',
    app: {
      isPackaged: options.isPackaged ?? true,
      getVersion: () => '1.0.0',
    },
    dialog: { showMessageBox },
    isDev: options.isDev ?? false,
    logger,
    updater,
  });

  return { listeners, logger, service, showMessageBox, updater };
}

describe('createAppUpdateService', () => {
  it('skips update checks in development builds', async () => {
    const { service, updater } = createFixture({ isDev: true });

    await service.checkForUpdates();

    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('skips update checks when the app is not packaged', async () => {
    const { service, updater } = createFixture({ isPackaged: false });

    await service.checkForUpdates();

    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('checks for updates and enables automatic download for packaged production builds', async () => {
    const { service, updater } = createFixture();

    await service.checkForUpdates();

    expect(updater.autoDownload).toBe(true);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('asks before installing a downloaded update', async () => {
    const { listeners, showMessageBox, updater } = createFixture();

    await listeners.get('update-downloaded')?.({ version: '1.1.0' });

    expect(showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        message: 'momoCAT 1.1.0 is ready to install.',
      }),
    );
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('does not install a downloaded update when the user chooses later', async () => {
    const { listeners, showMessageBox, updater } = createFixture();
    showMessageBox.mockResolvedValueOnce({ response: 1 });

    await listeners.get('update-downloaded')?.({ version: '1.1.0' });

    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('shows an up-to-date dialog only for manual checks', async () => {
    const { listeners, service, showMessageBox } = createFixture();

    await service.checkForUpdates();
    await listeners.get('update-not-available')?.({ version: '1.0.0' });

    expect(showMessageBox).not.toHaveBeenCalled();

    await service.checkForUpdates({ notifyNoUpdate: true });
    await listeners.get('update-not-available')?.({ version: '1.0.0' });

    expect(showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'momoCAT is up to date.',
      }),
    );
  });
});
