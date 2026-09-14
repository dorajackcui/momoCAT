export interface CommandIO {
  cwd: string;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  homeDir: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  exists: (filePath: string) => boolean;
  resolvePath: (value: string) => string;
}

type CommandOption = { name: string; value: string | true };

export function* readOptions(
  argv: string[],
  isKnownOption: (name: string) => boolean,
  isBooleanOption: (name: string) => boolean = () => false,
): Generator<CommandOption> {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}`);

    const equalsIndex = arg.indexOf('=');
    const flag = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
    const name = flag.slice(2);
    if (!isKnownOption(name)) throw new Error(`Unknown argument: ${flag}`);

    if (isBooleanOption(name)) {
      const next = argv[index + 1];
      if (equalsIndex !== -1 || (next && !next.startsWith('--'))) {
        throw new Error(`${flag} does not accept a value.`);
      }
      yield { name, value: true };
    } else if (equalsIndex !== -1) {
      yield { name, value: requireOptionValue(flag, arg.slice(equalsIndex + 1)) };
    } else {
      yield { name, value: readValue(argv, index, flag) };
      index += 1;
    }
  }
}

export function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

export function requireOptionValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

export function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

export function assertExistingPath(io: CommandIO, filePath: string, label: string): void {
  if (!io.exists(filePath)) {
    throw new Error(`${label} does not exist: ${filePath}`);
  }
}
