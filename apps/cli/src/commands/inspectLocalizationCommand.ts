import type { InspectLocalizationCommandConfig } from '@cat/localization';
import type { CliDependencies } from '../cli';
import {
  assertExistingPath,
  parsePositiveInteger,
  readValue,
  requireOptionValue,
} from '../parse/args';
import type { CommandIO } from '../parse/args';

export function runInspectLocalizationCliCommand(
  argv: string[],
  deps: CliDependencies,
  io: CommandIO,
): Promise<number> | number {
  if (argv[0] === '-h' || argv[0] === '--help') {
    io.stdout(help());
    return 0;
  }

  const config = parseInspectLocalizationArgs(argv, io);
  return deps.runInspectLocalizationCommand(config).then(() => 0);
}

function parseInspectLocalizationArgs(
  argv: string[],
  io: CommandIO,
): InspectLocalizationCommandConfig {
  const config: Partial<InspectLocalizationCommandConfig> = {};

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

      assignOption(
        config,
        name,
        arg.slice(equalsIndex + 1),
        io,
        arg.slice(0, equalsIndex),
      );
      continue;
    }

    const name = arg.slice(2);
    if (!isKnownOption(name)) {
      throw new Error(`Unknown argument: ${arg}`);
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

  return config as InspectLocalizationCommandConfig;
}

function assignOption(
  config: Partial<InspectLocalizationCommandConfig>,
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
  if (name === 'json-output') {
    config.jsonOutputPath = io.resolvePath(optionValue);
    return;
  }
  if (name === 'unit-limit') {
    config.unitLimit = parsePositiveInteger(optionValue, '--unit-limit');
    return;
  }
  if (name === 'max-cell-chars') {
    config.maxCellChars = parsePositiveInteger(optionValue, '--max-cell-chars');
    return;
  }
  if (name === 'request-mode') {
    if (optionValue !== 'window' && optionValue !== 'window-partial') {
      throw new Error('--request-mode must be window or window-partial.');
    }
    config.requestMode = optionValue;
    return;
  }

  throw new Error(`Unknown argument: --${name}`);
}

function isKnownOption(name: string): boolean {
  return (
    name === 'db' ||
    name === 'db-path' ||
    name === 'project-id' ||
    name === 'input' ||
    name === 'output' ||
    name === 'json-output' ||
    name === 'unit-limit' ||
    name === 'max-cell-chars' ||
    name === 'request-mode'
  );
}

function help(): string {
  return `Usage: momocat inspect localization --db <path> --project-id <id> --input <path> --output <path> [options]

Options:
  --db <path>, --db-path <path>    SQLite DB path.
  --project-id <id>                Project id that owns mounted TM/TB resources.
  --input <path>                   Spreadsheet path to inspect.
  --output <path>                  Output inspection spreadsheet path.
  --json-output <path>             Optional JSON artifact output path.
  --unit-limit <n>                 Optional maximum number of source units to inspect.
  --max-cell-chars <n>             Optional max characters per generated spreadsheet cell.
  --request-mode <mode>            window or window-partial.
  -h, --help                       Show this help.

Examples:
  momocat inspect localization --db .cat_data/cat_v1.db --project-id 1 --input mt.xlsx --output inspect.xlsx
`;
}
