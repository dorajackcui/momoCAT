import path from 'node:path';
import type { CommandIO } from '../parse/args';

export type DataEnvironmentSource =
  | 'explicit'
  | 'MOMOCAT_DB'
  | 'MOMOCAT_USER_DATA_DIR'
  | 'desktop-default'
  | 'source-checkout-fallback'
  | 'missing';

export interface DataEnvironmentResolution {
  dbPath?: string;
  userDataDir?: string;
  source: DataEnvironmentSource;
  exists: boolean;
  candidateDbPaths: string[];
  desktopUserDataDirCandidates: string[];
  aiRuntimeConfigPath?: string;
  aiRuntimeConfigExists: boolean;
  proxyEnvPath?: string;
  proxyEnvExists: boolean;
}

export interface ResolveDataEnvironmentOptions {
  explicitDbPath?: string;
}

interface Candidate {
  path: string;
  source: Exclude<DataEnvironmentSource, 'missing'>;
}

const PRODUCT_USER_DATA_DIR = 'Simple CAT Tool';
const PACKAGE_USER_DATA_DIR = 'simple-cat-tool';
const DB_FILE_NAME = 'cat_v1.db';
const AI_RUNTIME_FILE_NAME = 'ai-runtime.json';
const PROXY_ENV_FILE_NAME = 'proxy.env';

export function resolveDataEnvironment(
  io: CommandIO,
  options: ResolveDataEnvironmentOptions = {},
): DataEnvironmentResolution {
  const desktopUserDataDirCandidates = getDesktopUserDataDirCandidates(io);
  const candidates = buildDbCandidates(io, desktopUserDataDirCandidates, options);
  const selected = candidates.find((candidate) => io.exists(candidate.path));

  if (!selected) {
    const sourceCheckoutDbPath = sourceCheckoutDbPathFor(io);
    return {
      source: 'missing',
      exists: false,
      candidateDbPaths: candidates.map((candidate) => candidate.path),
      desktopUserDataDirCandidates,
      aiRuntimeConfigExists: false,
      proxyEnvExists: false,
      aiRuntimeConfigPath: siblingPath(sourceCheckoutDbPath, AI_RUNTIME_FILE_NAME),
      proxyEnvPath: siblingPath(sourceCheckoutDbPath, PROXY_ENV_FILE_NAME),
    };
  }

  const userDataDir = normalizeForDisplay(path.dirname(selected.path));
  const aiRuntimeConfigPath = siblingPath(selected.path, AI_RUNTIME_FILE_NAME);
  const proxyEnvPath = siblingPath(selected.path, PROXY_ENV_FILE_NAME);

  return {
    dbPath: selected.path,
    userDataDir,
    source: selected.source,
    exists: true,
    candidateDbPaths: candidates.map((candidate) => candidate.path),
    desktopUserDataDirCandidates,
    aiRuntimeConfigPath,
    aiRuntimeConfigExists: io.exists(aiRuntimeConfigPath),
    proxyEnvPath,
    proxyEnvExists: io.exists(proxyEnvPath),
  };
}

export function getDesktopUserDataDirCandidates(io: CommandIO): string[] {
  if (io.platform === 'win32') {
    const appData = io.env.APPDATA;
    if (!appData) return [];
    return [
      joinForDisplay(io, appData, PRODUCT_USER_DATA_DIR),
      joinForDisplay(io, appData, PACKAGE_USER_DATA_DIR),
    ];
  }

  if (io.platform === 'darwin') {
    const appSupport = joinForDisplay(io, io.homeDir, 'Library', 'Application Support');
    return [
      joinForDisplay(io, appSupport, PRODUCT_USER_DATA_DIR),
      joinForDisplay(io, appSupport, PACKAGE_USER_DATA_DIR),
    ];
  }

  const dirs: string[] = [];
  if (io.env.XDG_CONFIG_HOME) {
    dirs.push(joinForDisplay(io, io.env.XDG_CONFIG_HOME, PRODUCT_USER_DATA_DIR));
    dirs.push(joinForDisplay(io, io.env.XDG_CONFIG_HOME, PACKAGE_USER_DATA_DIR));
  }
  dirs.push(joinForDisplay(io, io.homeDir, '.config', PRODUCT_USER_DATA_DIR));
  dirs.push(joinForDisplay(io, io.homeDir, '.config', PACKAGE_USER_DATA_DIR));
  return dirs;
}

export function formatMissingDatabaseMessage(resolution: DataEnvironmentResolution): string {
  const candidates = resolution.candidateDbPaths.map((candidate) => `  - ${candidate}`).join('\n');
  return [
    'Could not find Momocat database.',
    'Open the desktop app once so it can create its user data, or pass --db <path>.',
    'Checked:',
    candidates,
  ].join('\n');
}

function buildDbCandidates(
  io: CommandIO,
  desktopUserDataDirCandidates: string[],
  options: ResolveDataEnvironmentOptions,
): Candidate[] {
  const candidates: Candidate[] = [];

  if (options.explicitDbPath) {
    candidates.push({
      path: io.resolvePath(options.explicitDbPath),
      source: 'explicit',
    });
  }

  if (io.env.MOMOCAT_DB) {
    candidates.push({
      path: io.resolvePath(io.env.MOMOCAT_DB),
      source: 'MOMOCAT_DB',
    });
  }

  if (io.env.MOMOCAT_USER_DATA_DIR) {
    candidates.push({
      path: joinForDisplay(io, io.env.MOMOCAT_USER_DATA_DIR, DB_FILE_NAME),
      source: 'MOMOCAT_USER_DATA_DIR',
    });
  }

  for (const userDataDir of desktopUserDataDirCandidates) {
    candidates.push({
      path: joinForDisplay(io, userDataDir, DB_FILE_NAME),
      source: 'desktop-default',
    });
  }

  candidates.push({
    path: sourceCheckoutDbPathFor(io),
    source: 'source-checkout-fallback',
  });

  return dedupeCandidates(candidates);
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.path)) return false;
    seen.add(candidate.path);
    return true;
  });
}

function sourceCheckoutDbPathFor(io: CommandIO): string {
  return joinForDisplay(io, io.cwd, '.cat_data', DB_FILE_NAME);
}

function siblingPath(filePath: string, siblingName: string): string {
  return normalizeForDisplay(path.join(path.dirname(filePath), siblingName));
}

function joinForDisplay(io: CommandIO, ...parts: string[]): string {
  return normalizeForDisplay(io.resolvePath(path.join(...parts)));
}

function normalizeForDisplay(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}
