import { QA_CHECK_NAMES, runQAFileCommand } from '@cat/localization';
import type { CliDependencies } from '../cli';
import { resolveCommandDataEnvironment } from '../env/dataEnvironment';
import {
  assertExistingPath,
  parsePositiveInteger,
  readOptions,
  type CommandIO,
} from '../parse/args';

export async function runQAFileCliCommand(
  argv: string[],
  deps: CliDependencies,
  io: CommandIO,
): Promise<number> {
  if (argv[0] === '--help' || argv[0] === '-h') {
    io.stdout(
      `Usage: momocat qa file --project-id <id> (--file-id <id> | --input <file>) [options]\n\nOptions:\n  --db <path>, --db-path <path>  Project database.\n  --check <name>                Override enabled groups; repeat for multiple groups.\n  --tag-policy default|none     External file marker policy.\n  --json                       Print the full grouped finding data as JSON.\n\nChecks: ${QA_CHECK_NAMES.join(', ')}\nUses saved project subchecks and options. Reads files without modifying them.\n`,
    );
    return 0;
  }
  const values = new Map<string, string>();
  const checks: string[] = [];
  const flags = new Set<string>();
  const names = ['db', 'db-path', 'project-id', 'file-id', 'input', 'check', 'tag-policy', 'json'];
  for (const option of readOptions(
    argv,
    (name) => names.includes(name),
    (name) => name === 'json',
  )) {
    if (option.value === true) flags.add(option.name);
    else if (option.name === 'check') {
      if (!(QA_CHECK_NAMES as readonly string[]).includes(option.value))
        throw new Error(`Unknown QA check: ${option.value}`);
      checks.push(option.value);
    } else values.set(option.name, option.value);
  }
  if (!values.has('project-id')) throw new Error('--project-id is required.');
  if (values.has('file-id') === values.has('input'))
    throw new Error('Specify exactly one of --file-id or --input.');
  const tagPolicy = values.get('tag-policy');
  if (tagPolicy && tagPolicy !== 'default' && tagPolicy !== 'none')
    throw new Error('--tag-policy must be default or none.');
  if (tagPolicy && values.has('file-id'))
    throw new Error('--tag-policy applies only to external files.');
  const dbPath = resolveCommandDataEnvironment(
    io,
    values.get('db-path') ?? values.get('db'),
  ).dbPath;
  assertExistingPath(io, dbPath, 'Database');
  const inputPath = values.has('input') ? io.resolvePath(values.get('input')!) : undefined;
  if (inputPath) assertExistingPath(io, inputPath, 'Input');
  const report = await (deps.runQAFileCommand ?? runQAFileCommand)({
    dbPath,
    projectId: parsePositiveInteger(values.get('project-id')!, '--project-id'),
    fileId: values.has('file-id')
      ? parsePositiveInteger(values.get('file-id')!, '--file-id')
      : undefined,
    inputPath,
    enabledRuleIds: checks.length ? checks : undefined,
    tagPolicy: tagPolicy as 'default' | 'none' | undefined,
  });
  if (flags.has('json')) io.stdout(`${JSON.stringify(report, null, 2)}\n`);
  else {
    io.stdout(
      `QA: ${report.checkedSegments} rows checked; ${report.issueCount} findings in ${report.affectedSegments} rows.\n`,
    );
    for (const issue of report.issues)
      io.stdout(
        `Row ${issue.row} [${issue.ruleId}] ${issue.groupLabel ? `${issue.groupLabel}: ` : ''}${issue.message}\n`,
      );
  }
  return 0;
}
