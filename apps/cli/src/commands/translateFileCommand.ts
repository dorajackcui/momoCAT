import type { TranslateFileCommandConfig } from '@cat/localization';
import type { CliDependencies } from '../cli';
import {
  assertExistingPath,
  parsePositiveInteger,
  readValue,
  requireOptionValue,
} from '../parse/args';
import type { CommandIO } from '../parse/args';

export function runTranslateFileCliCommand(
  argv: string[],
  deps: CliDependencies,
  io: CommandIO,
): Promise<number> | number {
  if (argv[0] === '-h' || argv[0] === '--help') {
    io.stdout(help());
    return 0;
  }

  const config = parseTranslateFileArgs(argv, io);
  return deps.runTranslateFileCommand(config).then(() => 0);
}

function parseTranslateFileArgs(argv: string[], io: CommandIO): TranslateFileCommandConfig {
  const config: Partial<TranslateFileCommandConfig> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const equalsIndex = arg.indexOf('=');

    if (!arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    if (equalsIndex !== -1) {
      const name = arg.slice(2, equalsIndex);
      if (!isKnownOption(name)) {
        throw new Error(`Unknown argument: ${arg.slice(0, equalsIndex)}`);
      }

      if (isBooleanOption(name)) {
        throw new Error(`${arg.slice(0, equalsIndex)} does not accept a value.`);
      }

      assignOption(config, name, arg.slice(equalsIndex + 1), io, arg.slice(0, equalsIndex));
      continue;
    }

    const name = arg.slice(2);
    if (!isKnownOption(name)) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    if (isBooleanOption(name)) {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        throw new Error(`${arg} does not accept a value.`);
      }
      assignBooleanOption(config, name);
      continue;
    }

    assignOption(config, name, readValue(argv, index, arg), io, arg);
    index += 1;
  }

  if (!config.dbPath) throw new Error('Missing --db.');
  if (config.projectId === undefined) throw new Error('Missing --project-id.');
  if (!config.inputPath) throw new Error('Missing --input.');
  if (!config.outputPath) throw new Error('Missing --output.');

  assertExistingPath(io, config.dbPath, 'Database');
  assertExistingPath(io, config.inputPath, 'Input file');

  return config as TranslateFileCommandConfig;
}

function assignOption(
  config: Partial<TranslateFileCommandConfig>,
  name: string,
  value: string | undefined,
  io: CommandIO,
  flag = `--${name}`,
): void {
  const optionValue = requireOptionValue(flag, value);

  if (name === 'db' || name === 'db-path') {
    config.dbPath = io.resolvePath(optionValue);
    return;
  }
  if (name === 'project-id') {
    config.projectId = parsePositiveInteger(optionValue, '--project-id');
    return;
  }
  if (name === 'input') {
    config.inputPath = io.resolvePath(optionValue);
    return;
  }
  if (name === 'output') {
    config.outputPath = io.resolvePath(optionValue);
    return;
  }
  if (name === 'target-scope') {
    if (optionValue !== 'blank-only' && optionValue !== 'overwrite-non-confirmed') {
      throw new Error('--target-scope must be blank-only or overwrite-non-confirmed.');
    }
    config.targetScope = optionValue;
    return;
  }
  if (name === 'checkpoint') {
    config.checkpointPath = io.resolvePath(optionValue);
    return;
  }
  if (name === 'events') {
    config.eventsPath = io.resolvePath(optionValue);
    return;
  }
  if (name === 'artifacts') {
    config.artifactsPath = io.resolvePath(optionValue);
    return;
  }
  if (name === 'max-attempts') {
    config.maxAttempts = parsePositiveInteger(optionValue, '--max-attempts');
    return;
  }
  if (name === 'batch-size') {
    config.batchSize = parseBatchSize(optionValue);
    return;
  }
  if (name === 'snapshot') {
    config.snapshotPath = io.resolvePath(optionValue);
    return;
  }
  if (name === 'snapshot-every-units') {
    config.snapshotEveryUnits = parsePositiveInteger(optionValue, '--snapshot-every-units');
    return;
  }
  if (name === 'snapshot-every-seconds') {
    config.snapshotEverySeconds = parsePositiveInteger(optionValue, '--snapshot-every-seconds');
    return;
  }

  throw new Error(`Unknown argument: --${name}`);
}

function assignBooleanOption(config: Partial<TranslateFileCommandConfig>, name: string): void {
  if (name === 'resume') {
    config.resume = true;
    return;
  }
  if (name === 'progress-stdout') {
    config.progressStdout = true;
    return;
  }

  throw new Error(`Unknown argument: --${name}`);
}

function parseBatchSize(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
    throw new Error('--batch-size must be an integer from 1 to 5.');
  }
  return parsed;
}

function isKnownOption(name: string): boolean {
  return (
    name === 'db' ||
    name === 'db-path' ||
    name === 'project-id' ||
    name === 'input' ||
    name === 'output' ||
    name === 'target-scope' ||
    name === 'checkpoint' ||
    name === 'events' ||
    name === 'artifacts' ||
    name === 'resume' ||
    name === 'max-attempts' ||
    name === 'batch-size' ||
    name === 'snapshot' ||
    name === 'snapshot-every-units' ||
    name === 'snapshot-every-seconds' ||
    name === 'progress-stdout'
  );
}

function isBooleanOption(name: string): boolean {
  return name === 'resume' || name === 'progress-stdout';
}

function help(): string {
  return `Usage: momocat translate file --db <path> --project-id <id> --input <path> --output <path> [options]

Options:
  --db <path>, --db-path <path>    SQLite DB path.
  --project-id <id>                Project id that owns mounted TM/TB resources.
  --input <path>                   Spreadsheet path to translate.
  --output <path>                  Translated spreadsheet output path.
  --target-scope <scope>           blank-only or overwrite-non-confirmed.
  --checkpoint <path>              Optional checkpoint sidecar path.
  --events <path>                  Optional events sidecar path.
  --artifacts <path>               Optional diagnostic artifact JSONL path.
  --resume                         Resume from checkpoint sidecars.
  --max-attempts <n>               Optional positive integer retry attempt limit.
  --batch-size <n>                 Optional batch size from 1 to 5.
  --snapshot <path>                Optional snapshot spreadsheet path.
  --snapshot-every-units <n>       Optional positive integer snapshot cadence by units.
  --snapshot-every-seconds <n>     Optional positive integer snapshot cadence by seconds.
  --progress-stdout                Forward progress events to stdout.
  -h, --help                       Show this help.

Examples:
  momocat translate file --db .cat_data/cat_v1.db --project-id 1 --input mt.xlsx --output translated.xlsx
`;
}
