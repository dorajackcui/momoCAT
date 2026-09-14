import type { TranslateFileCommandConfig } from '@cat/localization';
import type { CliDependencies } from '../cli';
import { parsePositiveInteger, readOptions } from '../parse/args';
import type { CommandIO } from '../parse/args';
import { assignLocalizationOption, resolveLocalizationConfig } from '../parse/localizationArgs';

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
  return deps.runTranslateFileCommand(config).then(({ summary }) => {
    if (summary.failed > 0) {
      io.stderr(
        `Translation failed for ${summary.failed} of ${summary.total} units. Partial output: ${config.outputPath}\n`,
      );
      return 1;
    }
    return 0;
  });
}

function parseTranslateFileArgs(argv: string[], io: CommandIO): TranslateFileCommandConfig {
  const config: Partial<TranslateFileCommandConfig> = {};
  let explicitDbPath: string | undefined;

  for (const { name, value } of readOptions(argv, isKnownOption, isBooleanOption)) {
    if (value === true) {
      assignBooleanOption(config, name);
    } else if (name === 'db' || name === 'db-path') {
      explicitDbPath = value;
    } else if (!assignLocalizationOption(config, name, value, io)) {
      assignOption(config, name, value, io);
    }
  }

  return resolveLocalizationConfig(config, io, explicitDbPath);
}

function assignOption(
  config: Partial<TranslateFileCommandConfig>,
  name: string,
  optionValue: string,
  io: CommandIO,
): void {
  if (name === 'context-header') {
    config.contextHeader = optionValue;
    return;
  }
  if (name === 'context-col') {
    config.contextCol = parseZeroBasedColumnIndex(optionValue);
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
  if (name === 'audit') {
    config.auditPath = io.resolvePath(optionValue);
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

function parseZeroBasedColumnIndex(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('--context-col must be a zero-based column index.');
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
    name === 'context-header' ||
    name === 'context-col' ||
    name === 'target-baseline' ||
    name === 'request-mode' ||
    name === 'tag-policy' ||
    name === 'checkpoint' ||
    name === 'events' ||
    name === 'artifacts' ||
    name === 'audit' ||
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
  return `Usage: momocat translate file [--db <path>] --project-id <id> --input <path> --output <path> [options]

Options:
  --db <path>, --db-path <path>    SQLite DB path. Default: installed desktop data, then .cat_data/cat_v1.db.
  --project-id <id>                Project id that owns mounted TM/TB resources.
  --input <path>                   Spreadsheet path to translate.
  --output <path>                  Translated spreadsheet output path.
  --context-header <header>        Optional context column header.
  --context-col <index>            Optional zero-based context column index.
  --target-baseline <baseline>     use-current-targets or ignore-current-targets. Default: use-current-targets.
  --request-mode <mode>            window or window-partial. Default: window-partial.
  --tag-policy <policy>            default or none.
  --checkpoint <path>              Optional checkpoint sidecar path.
  --events <path>                  Optional events sidecar path.
  --artifacts <path>               Optional diagnostic artifact JSONL path.
  --audit <path>                   Optional lightweight audit JSONL path.
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
