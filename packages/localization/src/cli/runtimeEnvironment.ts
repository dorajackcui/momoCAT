import fs from 'node:fs';
import {
  AIRuntimeConfigService,
  DefaultAIRuntimeConfigProvider,
} from '../providers/AIRuntimeConfigService';
import type { AIRuntimeConfigProvider } from '../ports';

export interface CommandRuntimeEnvironmentOptions {
  aiRuntimeConfigPath?: string;
  logger?: Pick<Console, 'warn'>;
}

export async function createCommandAIRuntimeConfigProvider(
  options: CommandRuntimeEnvironmentOptions,
): Promise<AIRuntimeConfigProvider> {
  if (!options.aiRuntimeConfigPath || !fs.existsSync(options.aiRuntimeConfigPath)) {
    return new DefaultAIRuntimeConfigProvider();
  }

  const service = new AIRuntimeConfigService(options.aiRuntimeConfigPath, options.logger ?? console);
  await service.initialize();
  return service;
}

export function loadProxyEnvFromFile(
  filePath: string | undefined,
  env: Record<string, string | undefined> = process.env,
): void {
  if (!filePath || !fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const normalized = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
    const separatorIndex = normalized.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = normalized.slice(0, separatorIndex).trim();
    const value = normalized.slice(separatorIndex + 1).trim();
    if (key) {
      env[key] = value;
    }
  }
}
