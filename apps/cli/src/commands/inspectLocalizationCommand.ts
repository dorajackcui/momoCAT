import type { CliDependencies } from '../cli';
import type { CommandIO } from '../parse/args';

export async function runInspectLocalizationCliCommand(
  argv: string[],
  _deps: CliDependencies,
  io: CommandIO,
): Promise<number> {
  if (argv[0] === '-h' || argv[0] === '--help') {
    io.stdout(help());
    return 0;
  }

  throw new Error('momocat inspect localization is not implemented yet.');
}

function help(): string {
  return `Usage: momocat inspect localization [options]
`;
}
