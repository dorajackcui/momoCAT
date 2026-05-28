import type { InspectProjectsResult } from '@cat/localization';
import type { CliDependencies } from '../cli';
import { formatMissingDatabaseMessage, resolveDataEnvironment } from '../env/dataEnvironment';
import {
  assertExistingPath,
  parsePositiveInteger,
  readValue,
  requireOptionValue,
} from '../parse/args';
import type { CommandIO } from '../parse/args';
import { formatProjectsInspection } from '../output/formatProjects';

interface InspectProjectsCliConfig {
  dbPath: string;
  projectId?: number;
  json: boolean;
}

export function runInspectProjectsCliCommand(
  argv: string[],
  deps: CliDependencies,
  io: CommandIO,
): number {
  if (argv[0] === '-h' || argv[0] === '--help') {
    io.stdout(help());
    return 0;
  }

  const config = parseInspectProjectsArgs(argv, io);
  const result = deps.runInspectProjectsCommand({
    dbPath: config.dbPath,
    projectId: config.projectId,
  }) as InspectProjectsResult;

  if (config.json) {
    io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    io.stdout(formatProjectsInspection(result));
  }

  return 0;
}

function parseInspectProjectsArgs(argv: string[], io: CommandIO): InspectProjectsCliConfig {
  const config: InspectProjectsCliConfig = {
    dbPath: '',
    json: false,
  };
  let explicitDbPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const equalsIndex = arg.indexOf('=');

    if (arg === '--db' || arg === '--db-path') {
      explicitDbPath = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--db=')) {
      explicitDbPath = requireOptionValue('--db', arg.slice('--db='.length));
      continue;
    }
    if (arg.startsWith('--db-path=')) {
      explicitDbPath = requireOptionValue('--db-path', arg.slice('--db-path='.length));
      continue;
    }
    if (arg === '--project-id') {
      config.projectId = parsePositiveInteger(readValue(argv, index, arg), '--project-id');
      index += 1;
      continue;
    }
    if (arg.startsWith('--project-id=')) {
      config.projectId = parsePositiveInteger(
        requireOptionValue('--project-id', arg.slice('--project-id='.length)),
        '--project-id',
      );
      continue;
    }
    if (arg === '--json') {
      config.json = true;
      continue;
    }
    if (equalsIndex !== -1) {
      throw new Error(`Unknown argument: ${arg.slice(0, equalsIndex)}`);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  const dataEnvironment = resolveDataEnvironment(io, { explicitDbPath });
  if (explicitDbPath && dataEnvironment.source !== 'explicit') {
    config.dbPath = io.resolvePath(explicitDbPath);
    assertExistingPath(io, config.dbPath, 'Database');
    return config;
  }
  if (!dataEnvironment.dbPath) {
    throw new Error(formatMissingDatabaseMessage(dataEnvironment));
  }
  config.dbPath = dataEnvironment.dbPath;
  assertExistingPath(io, config.dbPath, 'Database');
  return config;
}

function help(): string {
  return `Usage: momocat inspect projects [--db <path>] [options]

Options:
  --db <path>, --db-path <path>    SQLite DB path. Default: installed desktop data, then .cat_data/cat_v1.db.
  --project-id <id>                Optional project id filter.
  --json                           Print machine-readable JSON.
  -h, --help                       Show this help.

Examples:
  momocat inspect projects
  momocat inspect projects --db .cat_data/cat_v1.db
  momocat inspect projects --db .cat_data/cat_v1.db --project-id 3
  momocat inspect projects --db .cat_data/cat_v1.db --json
`;
}
