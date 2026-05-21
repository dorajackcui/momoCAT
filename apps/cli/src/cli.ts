import fs from 'node:fs';
import path from 'node:path';
import {
  runInspectLocalizationCommand,
  runInspectProjectsCommand,
  runTranslateFileCommand,
} from '@cat/localization';
import type {
  InspectLocalizationCommandConfig,
  InspectProjectsCommandConfig,
  TranslateFileCommandConfig,
} from '@cat/localization';
import type { CommandIO } from './parse/args';

export interface CliDependencies {
  runInspectProjectsCommand: (config: InspectProjectsCommandConfig) => unknown;
  runInspectLocalizationCommand: (config: InspectLocalizationCommandConfig) => Promise<unknown>;
  runTranslateFileCommand: (config: TranslateFileCommandConfig) => Promise<unknown>;
}

export const defaultDependencies: CliDependencies = {
  runInspectProjectsCommand,
  runInspectLocalizationCommand,
  runTranslateFileCommand,
};

export const defaultIO: CommandIO = {
  cwd: process.cwd(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  exists: (filePath) => fs.existsSync(filePath),
  resolvePath: (value) => path.resolve(value),
};

export async function runCli(
  argv: string[],
  deps: CliDependencies = defaultDependencies,
  io: CommandIO = defaultIO,
): Promise<number> {
  try {
    const [domain, action, ...rest] = argv;
    if (!domain || domain === '-h' || domain === '--help') {
      io.stdout(topLevelHelp());
      return 0;
    }

    if (domain === 'inspect' && action === 'projects') {
      const { runInspectProjectsCliCommand } = await import('./commands/inspectProjectsCommand');
      return runInspectProjectsCliCommand(rest, deps, io);
    }
    if (domain === 'inspect' && action === 'localization') {
      const { runInspectLocalizationCliCommand } = await import(
        './commands/inspectLocalizationCommand'
      );
      return runInspectLocalizationCliCommand(rest, deps, io);
    }
    if (domain === 'translate' && action === 'file') {
      const { runTranslateFileCliCommand } = await import('./commands/translateFileCommand');
      return runTranslateFileCliCommand(rest, deps, io);
    }

    const command = [domain, action].filter(Boolean).join(' ');
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`${message}\nRun: momocat --help\n`);
    return 1;
  }
}

function topLevelHelp(): string {
  return `Usage: momocat <command> [options]

Commands:
  inspect projects       Inspect project readiness, resources, files, and provider status.
  inspect localization   Inspect TM/TB/MT prompt artifacts without provider requests.
  translate file         Translate an external spreadsheet with resumable sidecars.

Run a command with --help for command-specific options.
`;
}
