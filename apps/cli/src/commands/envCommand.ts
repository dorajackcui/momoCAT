import { resolveDataEnvironment } from '../env/dataEnvironment';
import type { CommandIO } from '../parse/args';

export interface EnvCommandConfig {
  json: boolean;
}

const CLI_VERSION = '0.1.0';

export function runEnvCliCommand(argv: string[], io: CommandIO): number {
  if (argv[0] === '-h' || argv[0] === '--help') {
    io.stdout(help());
    return 0;
  }

  const config = parseEnvArgs(argv);
  const resolution = resolveDataEnvironment(io);

  if (config.json) {
    io.stdout(
      `${JSON.stringify(
        {
          cliVersion: CLI_VERSION,
          nodeVersion: process.version,
          platform: io.platform,
          database: {
            path: resolution.dbPath ?? null,
            source: resolution.source,
            exists: resolution.exists,
          },
          userDataDir: resolution.userDataDir ?? null,
          desktopUserDataDirCandidates: resolution.desktopUserDataDirCandidates,
          candidateDbPaths: resolution.candidateDbPaths,
          aiRuntimeConfig: {
            path: resolution.aiRuntimeConfigPath ?? null,
            exists: resolution.aiRuntimeConfigExists,
          },
          proxyEnv: {
            path: resolution.proxyEnvPath ?? null,
            exists: resolution.proxyEnvExists,
          },
          guidance: resolution.exists ? null : formatMissingEnvDatabaseMessage(resolution),
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  io.stdout(formatHumanEnv(resolution, io.platform));
  return 0;
}

function parseEnvArgs(argv: string[]): EnvCommandConfig {
  const config: EnvCommandConfig = { json: false };

  for (const arg of argv) {
    if (arg === '--json') {
      config.json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return config;
}

function formatHumanEnv(
  resolution: ReturnType<typeof resolveDataEnvironment>,
  platform: NodeJS.Platform,
): string {
  const dbLine = resolution.dbPath ?? 'not found';
  const aiRuntimeStatus = resolution.aiRuntimeConfigExists ? 'found' : 'missing';
  const proxyStatus = resolution.proxyEnvExists ? 'found' : 'missing';
  const candidateLines = resolution.candidateDbPaths.map((candidate) => `  - ${candidate}`);
  const guidance = resolution.exists ? '' : `\n${formatMissingEnvDatabaseMessage(resolution)}\n`;

  return `Momocat CLI Environment
CLI version: ${CLI_VERSION}
Node version: ${process.version}
Platform: ${platform}
Database: ${dbLine}
Source: ${resolution.source}
User data dir: ${resolution.userDataDir ?? 'not found'}
AI runtime config: ${resolution.aiRuntimeConfigPath ?? 'not found'} (${aiRuntimeStatus})
Proxy env: ${resolution.proxyEnvPath ?? 'not found'} (${proxyStatus})
Candidate databases:
${candidateLines.join('\n')}
${guidance}`;
}

function formatMissingEnvDatabaseMessage(
  resolution: ReturnType<typeof resolveDataEnvironment>,
): string {
  const candidates = resolution.candidateDbPaths.map((candidate) => `  - ${candidate}`).join('\n');
  return [
    'Could not find Momocat database.',
    'Open the desktop app once so it can create its user data, or set MOMOCAT_DB / MOMOCAT_USER_DATA_DIR before running momocat.',
    'Checked:',
    candidates,
  ].join('\n');
}

function help(): string {
  return `Usage: momocat env [--json]

Options:
  --json      Print machine-readable JSON.
  -h, --help  Show this help.
`;
}
