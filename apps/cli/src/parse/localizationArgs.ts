import type { TranslateFileCommandConfig } from '@cat/localization';
import { resolveCommandDataEnvironment } from '../env/dataEnvironment';
import { assertExistingPath, parsePositiveInteger, type CommandIO } from './args';

type LocalizationCliConfig = Pick<
  TranslateFileCommandConfig,
  | 'dbPath'
  | 'projectId'
  | 'inputPath'
  | 'outputPath'
  | 'requestMode'
  | 'targetBaseline'
  | 'tagPolicy'
  | 'aiRuntimeConfigPath'
  | 'proxyEnvPath'
>;

export function assignLocalizationOption(
  config: Partial<LocalizationCliConfig>,
  name: string,
  value: string,
  io: CommandIO,
): boolean {
  switch (name) {
    case 'project-id':
      config.projectId = parsePositiveInteger(value, '--project-id');
      return true;
    case 'input':
      config.inputPath = io.resolvePath(value);
      return true;
    case 'output':
      config.outputPath = io.resolvePath(value);
      return true;
    case 'request-mode':
      if (value !== 'window' && value !== 'window-partial') {
        throw new Error('--request-mode must be window or window-partial.');
      }
      config.requestMode = value;
      return true;
    case 'target-baseline':
      if (value !== 'use-current-targets' && value !== 'ignore-current-targets') {
        throw new Error('--target-baseline must be use-current-targets or ignore-current-targets.');
      }
      config.targetBaseline = value;
      return true;
    case 'tag-policy':
      if (value !== 'default' && value !== 'none') {
        throw new Error('--tag-policy must be default or none.');
      }
      config.tagPolicy = value;
      return true;
    default:
      return false;
  }
}

export function resolveLocalizationConfig<T extends Partial<LocalizationCliConfig>>(
  config: T,
  io: CommandIO,
  explicitDbPath?: string,
): T & LocalizationCliConfig {
  const dataEnvironment = resolveCommandDataEnvironment(io, explicitDbPath);
  const { projectId, inputPath, outputPath } = config;
  if (projectId === undefined) throw new Error('Missing --project-id.');
  if (!inputPath) throw new Error('Missing --input.');
  if (!outputPath) throw new Error('Missing --output.');

  assertExistingPath(io, dataEnvironment.dbPath, 'Database');
  assertExistingPath(io, inputPath, 'Input file');

  return {
    ...config,
    ...dataEnvironment,
    projectId,
    inputPath,
    outputPath,
    requestMode: config.requestMode ?? 'window-partial',
    targetBaseline: config.targetBaseline ?? 'use-current-targets',
  };
}
