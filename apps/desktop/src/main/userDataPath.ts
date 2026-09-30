import { dirname, join, resolve } from 'node:path';
import type { DesktopBuildFlavor } from './desktopBuildFlavor';

export const MOMOCAT_USER_DATA_DIR_ENV = 'MOMOCAT_USER_DATA_DIR';

interface ResolveDesktopUserDataPathOptions {
  appPath: string;
  defaultUserDataPath: string;
  isDev: boolean;
  buildFlavor?: DesktopBuildFlavor;
  appDataPath?: string;
  env?: NodeJS.ProcessEnv;
}

export function resolveDesktopUserDataPath({
  appPath,
  defaultUserDataPath,
  isDev,
  buildFlavor = 'local',
  appDataPath,
  env = process.env,
}: ResolveDesktopUserDataPathOptions): string {
  const explicitUserDataPath = env[MOMOCAT_USER_DATA_DIR_ENV]?.trim();
  if (explicitUserDataPath) return resolve(explicitUserDataPath);

  if (buildFlavor === 'cloud') {
    return isDev
      ? join(appPath, '../../.cat_data-cloud')
      : join(appDataPath ?? dirname(defaultUserDataPath), 'simple-cat-tool-cloud');
  }

  return isDev ? join(appPath, '../../.cat_data') : defaultUserDataPath;
}
