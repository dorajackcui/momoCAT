import { join, resolve } from 'node:path';

export const MOMOCAT_USER_DATA_DIR_ENV = 'MOMOCAT_USER_DATA_DIR';

interface ResolveDesktopUserDataPathOptions {
  appPath: string;
  defaultUserDataPath: string;
  isDev: boolean;
  env?: NodeJS.ProcessEnv;
}

export function resolveDesktopUserDataPath({
  appPath,
  defaultUserDataPath,
  isDev,
  env = process.env,
}: ResolveDesktopUserDataPathOptions): string {
  const explicitUserDataPath = env[MOMOCAT_USER_DATA_DIR_ENV]?.trim();
  if (explicitUserDataPath) return resolve(explicitUserDataPath);

  return isDev ? join(appPath, '../../.cat_data') : defaultUserDataPath;
}
