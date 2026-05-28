import { describe, expect, it } from 'vitest';
import {
  formatMissingDatabaseMessage,
  getDesktopUserDataDirCandidates,
  resolveDataEnvironment,
} from './dataEnvironment';
import type { CommandIO } from '../parse/args';

function createIO(
  overrides: Partial<CommandIO> & { existing?: string[] } = {},
): CommandIO {
  const existing = new Set((overrides.existing ?? []).map((value) => value.replaceAll('\\', '/')));
  return {
    cwd: overrides.cwd ?? 'D:/repo',
    env: overrides.env ?? {},
    platform: overrides.platform ?? 'win32',
    homeDir: overrides.homeDir ?? 'C:/Users/Ada',
    stdout: overrides.stdout ?? (() => undefined),
    stderr: overrides.stderr ?? (() => undefined),
    exists:
      overrides.exists ??
      ((filePath) => existing.has(filePath.replaceAll('\\', '/'))),
    resolvePath:
      overrides.resolvePath ??
      ((value) => value.replaceAll('\\', '/')),
  };
}

describe('data environment resolver', () => {
  it('uses explicit db path before environment defaults', () => {
    const io = createIO({
      env: {
        MOMOCAT_DB: 'C:/Users/Ada/AppData/Roaming/Simple CAT Tool/cat_v1.db',
      },
      existing: ['D:/custom/cat.db'],
    });

    const result = resolveDataEnvironment(io, { explicitDbPath: 'D:/custom/cat.db' });

    expect(result.dbPath).toBe('D:/custom/cat.db');
    expect(result.source).toBe('explicit');
    expect(result.exists).toBe(true);
    expect(result.userDataDir).toBe('D:/custom');
  });

  it('uses MOMOCAT_DB before MOMOCAT_USER_DATA_DIR', () => {
    const io = createIO({
      env: {
        MOMOCAT_DB: 'D:/env/cat.db',
        MOMOCAT_USER_DATA_DIR: 'D:/userData',
      },
      existing: ['D:/env/cat.db', 'D:/userData/cat_v1.db'],
    });

    const result = resolveDataEnvironment(io);

    expect(result.dbPath).toBe('D:/env/cat.db');
    expect(result.source).toBe('MOMOCAT_DB');
    expect(result.aiRuntimeConfigPath).toBe('D:/env/ai-runtime.json');
    expect(result.proxyEnvPath).toBe('D:/env/proxy.env');
  });

  it('uses MOMOCAT_USER_DATA_DIR when MOMOCAT_DB is not set', () => {
    const io = createIO({
      env: { MOMOCAT_USER_DATA_DIR: 'D:/userData' },
      existing: ['D:/userData/cat_v1.db'],
    });

    const result = resolveDataEnvironment(io);

    expect(result.dbPath).toBe('D:/userData/cat_v1.db');
    expect(result.userDataDir).toBe('D:/userData');
    expect(result.source).toBe('MOMOCAT_USER_DATA_DIR');
  });

  it('builds Windows desktop candidates from APPDATA', () => {
    const io = createIO({
      env: { APPDATA: 'C:/Users/Ada/AppData/Roaming' },
    });

    expect(getDesktopUserDataDirCandidates(io)).toEqual([
      'C:/Users/Ada/AppData/Roaming/Simple CAT Tool',
      'C:/Users/Ada/AppData/Roaming/simple-cat-tool',
    ]);
  });

  it('builds macOS desktop candidates from homeDir', () => {
    const io = createIO({ platform: 'darwin', homeDir: '/Users/ada' });

    expect(getDesktopUserDataDirCandidates(io)).toEqual([
      '/Users/ada/Library/Application Support/Simple CAT Tool',
      '/Users/ada/Library/Application Support/simple-cat-tool',
    ]);
  });

  it('builds Linux desktop candidates from XDG_CONFIG_HOME first', () => {
    const io = createIO({
      platform: 'linux',
      homeDir: '/home/ada',
      env: { XDG_CONFIG_HOME: '/tmp/config' },
    });

    expect(getDesktopUserDataDirCandidates(io)).toEqual([
      '/tmp/config/Simple CAT Tool',
      '/tmp/config/simple-cat-tool',
      '/home/ada/.config/Simple CAT Tool',
      '/home/ada/.config/simple-cat-tool',
    ]);
  });

  it('uses the first existing desktop candidate', () => {
    const io = createIO({
      env: { APPDATA: 'C:/Users/Ada/AppData/Roaming' },
      existing: ['C:/Users/Ada/AppData/Roaming/simple-cat-tool/cat_v1.db'],
    });

    const result = resolveDataEnvironment(io);

    expect(result.dbPath).toBe('C:/Users/Ada/AppData/Roaming/simple-cat-tool/cat_v1.db');
    expect(result.source).toBe('desktop-default');
  });

  it('falls back to source checkout .cat_data when it exists', () => {
    const io = createIO({ existing: ['D:/repo/.cat_data/cat_v1.db'] });

    const result = resolveDataEnvironment(io);

    expect(result.dbPath).toBe('D:/repo/.cat_data/cat_v1.db');
    expect(result.source).toBe('source-checkout-fallback');
  });

  it('returns candidates and guidance without creating a database when none exist', () => {
    const io = createIO({
      env: { APPDATA: 'C:/Users/Ada/AppData/Roaming' },
      existing: [],
    });

    const result = resolveDataEnvironment(io);

    expect(result.dbPath).toBeUndefined();
    expect(result.exists).toBe(false);
    expect(result.candidateDbPaths).toContain('D:/repo/.cat_data/cat_v1.db');
    expect(formatMissingDatabaseMessage(result)).toContain('Could not find Momocat database.');
    expect(formatMissingDatabaseMessage(result)).toContain('Open the desktop app once');
  });
});
