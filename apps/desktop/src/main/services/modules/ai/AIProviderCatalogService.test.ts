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
    testConnection: vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      endpoint: 'https://example.com/v1/chat/completions',
    }),
    createResponse: vi.fn(),
  } as unknown as AITransport;
}

describe('AIProviderCatalogService', () => {
  it('lists builtin OpenAI providers by default', () => {
    const service = new AIProviderCatalogService(createSettingsRepo(), createTransport());

    const providers = service.listProviders();

    expect(providers).toHaveLength(4);
    expect(providers[0]).toMatchObject({
      id: 'builtin:openai:gpt-5.4',
      name: 'OpenAI / gpt-5.4',
      baseUrl: 'https://api.openai.com/v1',
      protocol: 'chat-completions',
      kind: 'builtin',
    });
  });

  it('adds a custom provider and resolves its secret key', () => {
    const settingsRepo = createSettingsRepo();
    const service = new AIProviderCatalogService(settingsRepo, createTransport());

    const provider = service.addProvider({
      name: 'My Gateway',
      baseUrl: 'https://gateway.example.com/v1/',
      apiKey: 'secret-key-1234',
      model: 'gpt-demo',
    });

    expect(provider).toMatchObject({
      name: 'My Gateway',
      baseUrl: 'https://gateway.example.com/v1',
      model: 'gpt-demo',
      kind: 'custom',
    });

    expect(service.listProviders().some((item) => item.id === provider.id)).toBe(true);
    expect(service.resolveProviderConfig(provider.id)).toMatchObject({
      provider: expect.objectContaining({ id: provider.id }),
      apiKey: 'secret-key-1234',
    });
  });

  it('rejects duplicate provider names case-insensitively', () => {
    const service = new AIProviderCatalogService(createSettingsRepo(), createTransport());

    service.addProvider({
      name: 'My Gateway',
      baseUrl: 'https://gateway.example.com/v1',
      apiKey: 'secret-key-1234',
      model: 'gpt-demo',
    });

    expect(() =>
      service.addProvider({
        name: 'my gateway',
        baseUrl: 'https://gateway-2.example.com/v1',
        apiKey: 'secret-key-5678',
        model: 'gpt-demo-2',
      }),
    ).toThrow(/already exists/i);
  });

  it('blocks deleting a provider that is still referenced by a project', () => {
    const service = new AIProviderCatalogService(createSettingsRepo(), createTransport());
    const provider = service.addProvider({
      name: 'Busy Gateway',
      baseUrl: 'https://gateway.example.com/v1',
      apiKey: 'secret-key-1234',
      model: 'gpt-demo',
    });

    expect(() => service.deleteProvider(provider.id, true)).toThrow(/currently used/i);
  });

  it('maps legacy project ai values to builtin providers when resolving', () => {
    const settingsRepo = createSettingsRepo({
      openai_api_key: 'openai-secret-9876',
    });
    const service = new AIProviderCatalogService(settingsRepo, createTransport());

    const resolved = service.resolveProviderConfig('gpt-5-mini');

    expect(resolved.provider).toMatchObject({
      id: 'builtin:openai:gpt-5-mini',
      model: 'gpt-5-mini',
    });
    expect(resolved.apiKey).toBe('openai-secret-9876');
  });
});
