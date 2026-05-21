import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from './cli';

export { runCli } from './cli';

type Realpath = (filePath: string) => string;

export function isDirectRun(
  argvEntry: string | undefined,
  moduleUrl: string,
  realpath: Realpath = fs.realpathSync.native,
): boolean {
  if (!argvEntry) {
    return false;
  }

  return (
    resolveExecutablePath(argvEntry, realpath) ===
    resolveExecutablePath(fileURLToPath(moduleUrl), realpath)
  );
}

function resolveExecutablePath(filePath: string, realpath: Realpath): string {
  const resolved = path.resolve(filePath);
  try {
    return realpath(resolved);
  } catch {
    return resolved;
  }
}

if (isDirectRun(process.argv[1], import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2));
}
