import type { InspectLocalizationCommandConfig } from '@cat/localization';
import type { CliDependencies } from '../cli';
import { parsePositiveInteger, readOptions } from '../parse/args';
import type { CommandIO } from '../parse/args';
import { assignLocalizationOption, resolveLocalizationConfig } from '../parse/localizationArgs';

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
  let explicitDbPath: string | undefined;

  for (const { name, value } of readOptions(argv, isKnownOption)) {
    if (value === true) throw new Error(`Unknown argument: --${name}`);
    if (name === 'db' || name === 'db-path') {
      explicitDbPath = value;
    } else if (!assignLocalizationOption(config, name, value, io)) {
      assignOption(config, name, value, io);
    }
  }

  return resolveLocalizationConfig(config, io, explicitDbPath);
}

function assignOption(
  config: Partial<InspectLocalizationCommandConfig>,
  name: string,
  value: string,
  io: CommandIO,
): void {
  if (name === 'json-output') {
    config.jsonOutputPath = io.resolvePath(value);
    return;
  }
  if (name === 'unit-limit') {
    config.unitLimit = parsePositiveInteger(value, '--unit-limit');
    return;
  }
  if (name === 'max-cell-chars') {
    config.maxCellChars = parsePositiveInteger(value, '--max-cell-chars');
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
    name === 'request-mode' ||
    name === 'target-baseline' ||
    name === 'tag-policy'
  );
}

function help(): string {
  return `Usage: momocat inspect localization [--db <path>] --project-id <id> --input <path> --output <path> [options]

Options:
  --db <path>, --db-path <path>    SQLite DB path. Default: installed desktop data, then .cat_data/cat_v1.db.
  --project-id <id>                Project id that owns mounted TM/TB resources.
  --input <path>                   Spreadsheet path to inspect.
  --output <path>                  Output inspection spreadsheet path.
  --json-output <path>             Optional JSON artifact output path.
  --unit-limit <n>                 Optional maximum number of source units to inspect.
  --max-cell-chars <n>             Optional max characters per generated spreadsheet cell.
  --request-mode <mode>            window or window-partial. Default: window-partial.
  --target-baseline <baseline>     use-current-targets or ignore-current-targets. Default: use-current-targets.
  --tag-policy <policy>            default or none.
  -h, --help                       Show this help.

Examples:
  momocat inspect localization --db .cat_data/cat_v1.db --project-id 1 --input mt.xlsx --output inspect.xlsx
`;
}
