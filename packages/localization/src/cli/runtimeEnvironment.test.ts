import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCommandAIRuntimeConfigProvider,
  loadProxyEnvFromFile,
} from './runtimeEnvironment';

const tempRoots: string[] = [];

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'momocat-runtime-env-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('CLI runtime environment helpers', () => {
  it('loads model runtime config from an existing ai-runtime.json', async () => {
    const root = createTempRoot();
    const configPath = path.join(root, 'ai-runtime.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        version: 1,
        models: {
          'gpt-test': { reasoningEffort: 'high' },
        },
      }),
    );

    const provider = await createCommandAIRuntimeConfigProvider({ aiRuntimeConfigPath: configPath });

    await expect(provider.getModelConfig('gpt-test')).resolves.toEqual({
      reasoningEffort: 'high',
    });
  });

  it('uses default runtime config when ai-runtime.json is missing without creating a file', async () => {
    const root = createTempRoot();
    const configPath = path.join(root, 'ai-runtime.json');

    const provider = await createCommandAIRuntimeConfigProvider({ aiRuntimeConfigPath: configPath });

    await expect(provider.getModelConfig('gpt-test')).resolves.toEqual({
      reasoningEffort: 'medium',
    });
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('loads proxy env values from KEY=value and export KEY=value lines', () => {
    const root = createTempRoot();
    const proxyPath = path.join(root, 'proxy.env');
    const env: Record<string, string | undefined> = {};
    fs.writeFileSync(
      proxyPath,
      ['# comment', 'HTTPS_PROXY=https://proxy.example', 'export ALL_PROXY=socks://proxy.example'].join('\n'),
    );

    loadProxyEnvFromFile(proxyPath, env);

    expect(env.HTTPS_PROXY).toBe('https://proxy.example');
    expect(env.ALL_PROXY).toBe('socks://proxy.example');
  });

  it('ignores missing proxy env files', () => {
    const env: Record<string, string | undefined> = {};

    loadProxyEnvFromFile(path.join(createTempRoot(), 'missing.env'), env);

    expect(env).toEqual({});
  });
});
