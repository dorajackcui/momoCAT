import { describe, expect, it, vi } from 'vitest';
import { AIProviderCatalogService } from './AIProviderCatalogService';
import type { AITransport, SettingsRepository } from '../../ports';

function createSettingsRepo(seed: Record<string, string | null> = {}): SettingsRepository {
  const store = new Map<string, string | null>(Object.entries(seed));

  return {
    getSetting: (key: string) => {
      const value = store.get(key);
      return value === null ? undefined : value;
    },
    setSetting: (key: string, value: string | null) => {
      store.set(key, value);
    },
  };
}

function createTransport(): AITransport {
  return {
    listModels: vi.fn().mockResolvedValue({
      models: ['gpt-demo', 'text-embedding-3-large', 'whisper-large', 'gpt-demo-mini'],
      status: 200,
      endpoint: 'https://example.com/v1/models',
    }),
    testConnection: vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      endpoint: 'https://example.com/v1/chat/completions',
    }),
    createResponse: vi.fn(),
  } as unknown as AITransport;
}

describe('AIProviderCatalogService', () => {
  it('does not synthesize fixed builtin OpenAI model providers', () => {
    const service = new AIProviderCatalogService(createSettingsRepo(), createTransport());

    expect(service.listProviders()).toEqual([]);
  });

  it('creates providers through the shared connection-backed implementation', async () => {
    const service = new AIProviderCatalogService(createSettingsRepo(), createTransport());
    const tested = await service.testConnection({
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'secret-1234',
    });

    const provider = await service.addProvider({
      name: 'OpenAI / gpt-demo',
      connectionId: tested.connection!.id,
      model: 'gpt-demo',
    });

    expect(provider).toMatchObject({
      name: 'OpenAI / gpt-demo',
      kind: 'configured',
      model: 'gpt-demo',
    });
  });
});
