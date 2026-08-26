import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDesktopUserDataPath } from './userDataPath';

describe('resolveDesktopUserDataPath', () => {
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
