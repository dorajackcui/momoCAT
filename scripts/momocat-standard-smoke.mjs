#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repoRoot, 'apps', 'cli', 'dist', 'index.mjs');
const defaultConfigPath = path.join(repoRoot, '.momocat-smoke.local.json');
const exampleConfigPath = path.join(repoRoot, '.momocat-smoke.example.json');

const options = parseOptions(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const smoke = loadSmokeConfig(options.configPath ?? defaultConfigPath);
if (options.requestMode) {
  smoke.requestMode = options.requestMode;
}
const stem = options.prefix ?? `momocat-standard-smoke-${timestampForFile(new Date())}`;
const artifacts = {
  inspectXlsx: path.join(smoke.outputDir, `${stem}-inspect.xlsx`),
  inspectJson: path.join(smoke.outputDir, `${stem}-inspect.json`),
  translatedXlsx: path.join(smoke.outputDir, `${stem}-translated.xlsx`),
  checkpoint: path.join(smoke.outputDir, `${stem}.checkpoint.jsonl`),
  events: path.join(smoke.outputDir, `${stem}.events.jsonl`),
  promptArtifacts: path.join(smoke.outputDir, `${stem}.artifacts.jsonl`),
  snapshot: path.join(smoke.outputDir, `${stem}.snapshot.xlsx`),
};

if (!options.dryRun && !existsSync(cliPath)) {
  console.error(`Missing built CLI: ${cliPath}`);
  console.error('Run: npm run build:cli');
  process.exit(1);
}

printHeader();
mkdirSync(smoke.outputDir, { recursive: true });

runCli('inspect projects', [
  'inspect',
  'projects',
  '--db',
  smoke.dbPath,
  '--project-id',
  String(smoke.projectId),
]);

runCli('inspect localization', [
  'inspect',
  'localization',
  '--db',
  smoke.dbPath,
  '--project-id',
  String(smoke.projectId),
  '--input',
  smoke.inputPath,
  '--output',
  artifacts.inspectXlsx,
  '--json-output',
  artifacts.inspectJson,
  '--unit-limit',
  String(smoke.inspectUnitLimit),
  ...requestModeArgs(smoke.requestMode),
]);

if (!options.inspectOnly) {
  runCli('translate file', [
    'translate',
    'file',
    '--db',
    smoke.dbPath,
    '--project-id',
    String(smoke.projectId),
    '--input',
    smoke.inputPath,
    '--output',
    artifacts.translatedXlsx,
    '--checkpoint',
    artifacts.checkpoint,
    '--events',
    artifacts.events,
    '--artifacts',
    artifacts.promptArtifacts,
    '--snapshot',
    artifacts.snapshot,
    '--max-attempts',
    String(smoke.maxAttempts),
    '--batch-size',
    String(smoke.batchSize),
    ...requestModeArgs(smoke.requestMode),
    '--progress-stdout',
  ]);
}

if (!options.dryRun) {
  printArtifacts();
}

function parseArgs(argv) {
  const parsed = {
    configPath: undefined,
    dryRun: false,
    help: false,
    inspectOnly: false,
    prefix: undefined,
    requestMode: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '-h' || arg === '--help') {
      parsed.help = true;
      continue;
    }
    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    if (arg === '--inspect-only') {
      parsed.inspectOnly = true;
      continue;
    }
    if (arg === '--config') {
      parsed.configPath = readRequiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--config=')) {
      parsed.configPath = readEqualsValue(arg, '--config');
      continue;
    }
    if (arg === '--prefix') {
      parsed.prefix = readRequiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--prefix=')) {
      parsed.prefix = readEqualsValue(arg, '--prefix');
      continue;
    }
    if (arg === '--request-mode') {
      parsed.requestMode = requestMode(readRequiredValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith('--request-mode=')) {
      parsed.requestMode = requestMode(readEqualsValue(arg, '--request-mode'));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (parsed.configPath) {
    parsed.configPath = resolvePath(parsed.configPath);
  }

  return parsed;
}

function parseOptions(argv) {
  try {
    return parseArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    console.error('Run: npm run smoke:momocat -- --help');
    process.exit(1);
  }
}

function loadSmokeConfig(configPath) {
  if (!existsSync(configPath)) {
    console.error(`Missing smoke config: ${configPath}`);
    console.error(`Create it from: ${exampleConfigPath}`);
    console.error(
      'This local config is gitignored; keep machine paths and provider endpoints there.',
    );
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(configPath, 'utf8'));
  return {
    inputPath: requiredString(raw.inputPath, 'inputPath'),
    dbPath: requiredString(raw.dbPath, 'dbPath'),
    projectId: positiveInteger(raw.projectId, 'projectId'),
    outputDir: raw.outputDir
      ? resolvePath(requiredString(raw.outputDir, 'outputDir'))
      : path.join(repoRoot, 'testoutput'),
    inspectUnitLimit:
      raw.inspectUnitLimit === undefined
        ? 10
        : positiveInteger(raw.inspectUnitLimit, 'inspectUnitLimit'),
    maxAttempts:
      raw.maxAttempts === undefined ? 1 : positiveInteger(raw.maxAttempts, 'maxAttempts'),
    batchSize: raw.batchSize === undefined ? 5 : batchSize(raw.batchSize),
    requestMode: raw.requestMode === undefined ? undefined : requestMode(raw.requestMode),
  };
}

function requestModeArgs(value) {
  return value ? ['--request-mode', value] : [];
}

function runCli(label, args) {
  const command = [process.execPath, cliPath, ...args];
  console.log(`\n== ${label} ==`);

  if (options.dryRun) {
    console.log(command.map(quoteShellArg).join(' '));
    return;
  }

  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function printHeader() {
  console.log('Momocat standard translate smoke');
  console.log(`  config: ${options.configPath ?? defaultConfigPath}`);
  console.log(`  file: ${smoke.inputPath}`);
  console.log(`  db: ${smoke.dbPath}`);
  console.log(`  project id: ${smoke.projectId}`);
  console.log(`  output dir: ${smoke.outputDir}`);
  console.log(`  prefix: ${stem}`);
  if (!options.inspectOnly) {
    console.log('  translate: real provider smoke; sends source text and project context');
  }
}

function printArtifacts() {
  console.log('\nArtifacts:');
  for (const filePath of Object.values(artifacts)) {
    if (!existsSync(filePath)) {
      console.log(`  missing ${filePath}`);
      continue;
    }
    const stats = statSync(filePath);
    const lineSuffix = filePath.endsWith('.jsonl') ? `, ${countLines(filePath)} lines` : '';
    console.log(`  ${filePath} (${stats.size} bytes${lineSuffix})`);
  }
}

function countLines(filePath) {
  const text = readFileSync(filePath, 'utf8');
  return text.trim() ? text.trimEnd().split(/\r?\n/).length : 0;
}

function readRequiredValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function readEqualsValue(arg, flag) {
  const value = arg.slice(`${flag}=`.length);
  if (!value) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Smoke config field "${field}" must be a non-empty string.`);
  }
  return resolvePath(value);
}

function optionalString(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error('Optional smoke config metadata fields must be strings.');
  }
  return value;
}

function positiveInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Smoke config field "${field}" must be a positive integer.`);
  }
  return parsed;
}

function batchSize(value) {
  const parsed = positiveInteger(value, 'batchSize');
  if (parsed > 5) {
    throw new Error('Smoke config field "batchSize" must be an integer from 1 to 5.');
  }
  return parsed;
}

function requestMode(value) {
  if (value !== 'window' && value !== 'window-partial') {
    throw new Error('Smoke config field "requestMode" must be "window" or "window-partial".');
  }
  return value;
}

function resolvePath(value) {
  return path.isAbsolute(value) ? value : path.join(repoRoot, value);
}

function timestampForFile(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function quoteShellArg(value) {
  if (!/[ \t"]/u.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '\\"')}"`;
}

function printHelp() {
  console.log(`Usage: npm run smoke:momocat -- [options]

Runs the configured local momocat smoke flow:
  1. inspect projects
  2. inspect localization
  3. translate file

The default config path is .momocat-smoke.local.json. This file is gitignored.
Create it from .momocat-smoke.example.json and keep local paths/provider metadata there.

Options:
  --config <path>         Use a different local smoke config file.
  --dry-run               Print the commands without running them.
  --inspect-only          Run project readiness and no-request inspect only.
  --prefix <name>         Override the output artifact filename prefix.
  --request-mode <mode>   Override inspect/translate request mode: window or window-partial.
  -h, --help              Show this help.
`);
}
