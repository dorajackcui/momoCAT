import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDesktopUserDataPath } from './userDataPath';

describe('resolveDesktopUserDataPath', () => {
  it('isolates installed cloud data even if Electron has cached the local default', () => {
    expect(
      resolveDesktopUserDataPath({
        appPath: join('installed', 'momoCAT Cloud'),
        defaultUserDataPath: join('profile', 'simple-cat-tool'),
        appDataPath: 'profile',
        isDev: false,
        buildFlavor: 'cloud',
        env: {},
      }),
    ).toBe(join('profile', 'simple-cat-tool-cloud'));
  });

  it('uses a separate cloud development profile', () => {
    expect(
      resolveDesktopUserDataPath({
        appPath: join('workspace', 'apps', 'desktop'),
        defaultUserDataPath: join('profile', 'momoCAT'),
        isDev: true,
        buildFlavor: 'cloud',
        env: {},
      }),
    ).toBe(join('workspace', '.cat_data-cloud'));
  });

  it('honors an explicit cloud test profile', () => {
    expect(
      resolveDesktopUserDataPath({
        appPath: join('workspace', 'apps', 'desktop'),
        defaultUserDataPath: join('profile', 'momoCAT'),
        isDev: false,
        buildFlavor: 'cloud',
        env: { MOMOCAT_USER_DATA_DIR: join('fixtures', 'cloud') },
      }),
    ).toBe(resolve('fixtures', 'cloud'));
  });

  it('keeps development data in the repository default directory', () => {
    expect(
      resolveDesktopUserDataPath({
        appPath: join('workspace', 'apps', 'desktop'),
        defaultUserDataPath: join('profile', 'momoCAT'),
        isDev: true,
        env: {},
      }),
    ).toBe(join('workspace', '.cat_data'));
  });

  it('keeps the Electron default in packaged builds', () => {
    const defaultUserDataPath = join('profile', 'momoCAT');

    expect(
      resolveDesktopUserDataPath({
        appPath: join('installed', 'momoCAT'),
        defaultUserDataPath,
        isDev: false,
        env: {},
      }),
    ).toBe(defaultUserDataPath);
  });

  it('honors an explicit isolated user-data directory', () => {
    expect(
      resolveDesktopUserDataPath({
        appPath: join('workspace', 'apps', 'desktop'),
        defaultUserDataPath: join('profile', 'momoCAT'),
        isDev: true,
        env: { MOMOCAT_USER_DATA_DIR: join('fixtures', 'demo-user-data') },
      }),
    ).toBe(resolve('fixtures', 'demo-user-data'));
  });

  it('ignores a blank override', () => {
    expect(
      resolveDesktopUserDataPath({
        appPath: join('workspace', 'apps', 'desktop'),
        defaultUserDataPath: join('profile', 'momoCAT'),
        isDev: true,
        env: { MOMOCAT_USER_DATA_DIR: '   ' },
      }),
    ).toBe(join('workspace', '.cat_data'));
  });
});
