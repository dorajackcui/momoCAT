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
