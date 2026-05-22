import { describe, expect, it, vi } from 'vitest';
import {
  AIProviderCatalogService,
  filterDiscoveredModelIds,
} from './AIProviderCatalogService';
import type { AITransport, SettingsRepository } from '../ports';

function createSettingsRepo(seed: Record<string, string | null> = {}): SettingsRepository & {
  dump(): Record<string, string | null>;
} {
  const store = new Map<string, string | null>(Object.entries(seed));
  return {
    getSetting: (key: string) => {
      const value = store.get(key);
      return value === null ? undefined : value;
    },
    setSetting: (key: string, value: string | null) => {
      store.set(key, value);
    },
    dump: () => Object.fromEntries(store.entries()),
  };
}

function createTransport(overrides: Partial<AITransport> = {}): AITransport {
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
    ...overrides,
  } as AITransport;
}

const LEGACY_PROVIDER = {
  id: 'custom:legacy',
  name: 'Legacy Provider',
  baseUrl: 'https://legacy.example/v1/',
  model: 'gpt-legacy',
  protocol: 'chat-completions',
  kind: 'custom',
  apiKeyLast4: '9999',
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
};

describe('filterDiscoveredModelIds', () => {
  it('trims dedupes and filters non-text model ids while preserving order', () => {
    expect(
      filterDiscoveredModelIds([
        ' gpt-demo ',
        'text-embedding-3-large',
        'embed-v1',
        'whisper-large',
        'audio-preview',
        'tts-1',
        'gpt-demo',
        'image-only-model',
        'vision-image-pro',
        'gpt-demo-mini',
        '',
        'image-generator',
      ]),
    ).toEqual(['gpt-demo', 'gpt-demo-mini']);
  });
});

describe('AIProviderCatalogService', () => {
  it('tests and stores a reusable connection with filtered discovered models', async () => {
    const settingsRepo = createSettingsRepo();
    const transport = createTransport();
    const service = new AIProviderCatalogService(settingsRepo, transport);

    const result = await service.testConnection({
      name: 'OpenAI',
      baseUrl: 'https://example.com/v1/',
      apiKey: 'secret-key-1234',
    });

    expect(result.ok).toBe(true);
    expect(result.models).toEqual(['gpt-demo', 'gpt-demo-mini']);
    expect(result.connection).toMatchObject({
      name: 'OpenAI',
      baseUrl: 'https://example.com/v1',
      discoveredModels: ['gpt-demo', 'gpt-demo-mini'],
      apiKeyLast4: '1234',
    });
    expect(transport.listModels).toHaveBeenCalledWith({
      apiKey: 'secret-key-1234',
      baseUrl: 'https://example.com/v1',
    });
    expect(settingsRepo.dump()[`ai_connection_key::${result.connection?.id}`]).toBe(
      'secret-key-1234',
    );
    expect(JSON.parse(settingsRepo.dump().ai_connection_catalog_v1 ?? '[]')).toHaveLength(1);
  });

  it('updates an existing connection without changing its id or created timestamp', async () => {
    const settingsRepo = createSettingsRepo();
    const transport = createTransport({
      listModels: vi.fn().mockResolvedValue({
        models: ['gpt-updated'],
        status: 200,
        endpoint: 'https://updated.example/v1/models',
      }),
    });
    const service = new AIProviderCatalogService(settingsRepo, createTransport());
    const initial = await service.testConnection({
      name: 'OpenAI',
      baseUrl: 'https://example.com/v1',
      apiKey: 'secret-key-1234',
    });
    const updater = new AIProviderCatalogService(settingsRepo, transport);

    const updated = await updater.testConnection({
      connectionId: initial.connection!.id,
      name: 'Gateway',
      baseUrl: 'https://updated.example/v1/',
      apiKey: 'updated-key-5678',
    });

    expect(updated.ok).toBe(true);
    expect(updated.connection).toMatchObject({
      id: initial.connection!.id,
      name: 'Gateway',
      baseUrl: 'https://updated.example/v1',
      discoveredModels: ['gpt-updated'],
      apiKeyLast4: '5678',
      createdAt: initial.connection!.createdAt,
    });
    expect(settingsRepo.dump()[`ai_connection_key::${initial.connection!.id}`]).toBe(
      'updated-key-5678',
    );
  });

  it('returns a failure and does not store a connection when no usable text models are discovered', async () => {
    const settingsRepo = createSettingsRepo();
    const service = new AIProviderCatalogService(
      settingsRepo,
      createTransport({
        listModels: vi.fn().mockResolvedValue({
          models: ['text-embedding-3-large', 'whisper-large'],
          status: 200,
          endpoint: 'https://example.com/v1/models',
        }),
      }),
    );

    const result = await service.testConnection({
      name: 'OpenAI',
      baseUrl: 'https://example.com/v1',
      apiKey: 'secret-key-1234',
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'No usable text models were discovered.',
    });
    expect(settingsRepo.dump().ai_connection_catalog_v1).toBeUndefined();
  });

  it('creates a configured provider from a saved connection model', async () => {
    const settingsRepo = createSettingsRepo();
    const transport = createTransport();
    const service = new AIProviderCatalogService(settingsRepo, transport);
    const tested = await service.testConnection({
      name: 'OpenAI',
      baseUrl: 'https://example.com/v1',
      apiKey: 'secret-key-1234',
    });

    const provider = await service.addProvider({
      name: 'OpenAI / gpt-demo',
      connectionId: tested.connection!.id,
      model: 'gpt-demo',
    });

    expect(provider).toMatchObject({
      name: 'OpenAI / gpt-demo',
      connectionId: tested.connection!.id,
      connectionName: 'OpenAI',
      baseUrl: 'https://example.com/v1',
      model: 'gpt-demo',
      kind: 'configured',
      apiKeyLast4: '1234',
    });
    expect(transport.testConnection).toHaveBeenCalledWith({
      apiKey: 'secret-key-1234',
      baseUrl: 'https://example.com/v1',
      model: 'gpt-demo',
    });
    expect(JSON.parse(settingsRepo.dump().ai_provider_catalog_v2 ?? '[]')).toHaveLength(1);
    expect(service.listProviders()).toEqual([provider]);
    expect(service.listProviders().some((candidate) => candidate.id.startsWith('builtin:'))).toBe(
      false,
    );
  });

  it('rejects provider creation when the connection model or key is missing', async () => {
    const settingsRepo = createSettingsRepo();
    const service = new AIProviderCatalogService(settingsRepo, createTransport());
    const tested = await service.testConnection({
      name: 'OpenAI',
      baseUrl: 'https://example.com/v1',
      apiKey: 'secret-key-1234',
    });

    await expect(
      service.addProvider({
        name: 'OpenAI / unknown',
        connectionId: tested.connection!.id,
        model: 'unknown-model',
      }),
    ).rejects.toThrow(/was not discovered/);

    settingsRepo.setSetting(`ai_connection_key::${tested.connection!.id}`, null);
    await expect(
      service.addProvider({
        name: 'OpenAI / gpt-demo',
        connectionId: tested.connection!.id,
        model: 'gpt-demo',
      }),
    ).rejects.toThrow(/API key is missing for connection "OpenAI"/);
  });

  it('resolves configured providers to baseUrl apiKey and model', async () => {
    const settingsRepo = createSettingsRepo();
    const service = new AIProviderCatalogService(settingsRepo, createTransport());
    const tested = await service.testConnection({
      name: 'Gateway',
      baseUrl: 'https://gateway.example/v1',
      apiKey: 'gateway-secret-9999',
    });
    const provider = await service.addProvider({
      name: 'Gateway Main',
      connectionId: tested.connection!.id,
      model: 'gpt-demo',
    });

    expect(service.resolveProviderConfig(provider.id)).toMatchObject({
      provider: expect.objectContaining({
        id: provider.id,
        model: 'gpt-demo',
        baseUrl: 'https://gateway.example/v1',
      }),
      apiKey: 'gateway-secret-9999',
    });
  });

  it('falls old builtin ids and missing ids back to the first configured provider', async () => {
    const service = new AIProviderCatalogService(createSettingsRepo(), createTransport());
    const tested = await service.testConnection({
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'openai-secret-1234',
    });
    const provider = await service.addProvider({
      name: 'OpenAI / gpt-demo',
      connectionId: tested.connection!.id,
      model: 'gpt-demo',
    });

    expect(service.resolveProviderConfig('builtin:openai:gpt-5.4-mini').provider.id).toBe(
      provider.id,
    );
    expect(service.resolveProviderConfig('').provider.id).toBe(provider.id);
    expect(service.resolveProviderConfig(null).provider.id).toBe(provider.id);
  });

  it('throws a setup error when no configured provider exists', () => {
    const service = new AIProviderCatalogService(createSettingsRepo(), createTransport());

    expect(() => service.resolveProviderConfig('builtin:openai:gpt-5.4-mini')).toThrow(
      /AI provider is not configured/i,
    );
  });

  it('reads legacy custom providers without generating old builtins or writing v2 settings', () => {
    const settingsRepo = createSettingsRepo({
      ai_provider_catalog_v1: JSON.stringify([LEGACY_PROVIDER]),
      'ai_provider_key::custom:legacy': 'legacy-secret-9999',
      openai_api_key: 'global-openai-key-0000',
    });
    const service = new AIProviderCatalogService(settingsRepo, createTransport());

    expect(service.listProviders()).toEqual([
      expect.objectContaining({
        id: 'custom:legacy',
        name: 'Legacy Provider',
        baseUrl: 'https://legacy.example/v1',
        model: 'gpt-legacy',
        kind: 'legacy',
        connectionId: 'legacy:connection:custom:legacy',
        connectionName: 'Legacy Provider',
        apiKeyLast4: '9999',
      }),
    ]);
    expect(settingsRepo.dump().ai_provider_catalog_v2).toBeUndefined();
    expect(Object.keys(settingsRepo.dump()).some((key) => key.startsWith('ai_connection_'))).toBe(
      false,
    );
  });

  it('resolves legacy custom providers with their legacy provider key', () => {
    const settingsRepo = createSettingsRepo({
      ai_provider_catalog_v1: JSON.stringify([LEGACY_PROVIDER]),
      'ai_provider_key::custom:legacy': 'legacy-secret-9999',
    });
    const service = new AIProviderCatalogService(settingsRepo, createTransport());

    expect(service.resolveProviderConfig('custom:legacy')).toEqual({
      provider: expect.objectContaining({
        id: 'custom:legacy',
        name: 'Legacy Provider',
        baseUrl: 'https://legacy.example/v1',
        model: 'gpt-legacy',
        kind: 'legacy',
        connectionId: 'legacy:connection:custom:legacy',
      }),
      apiKey: 'legacy-secret-9999',
    });
  });

  it('resolves legacy custom providers with the global OpenAI key fallback', () => {
    const settingsRepo = createSettingsRepo({
      ai_provider_catalog_v1: JSON.stringify([LEGACY_PROVIDER]),
      openai_api_key: 'global-openai-key-0000',
    });
    const service = new AIProviderCatalogService(settingsRepo, createTransport());

    expect(service.resolveProviderConfig('custom:legacy')).toEqual({
      provider: expect.objectContaining({
        id: 'custom:legacy',
        baseUrl: 'https://legacy.example/v1',
        model: 'gpt-legacy',
        kind: 'legacy',
        apiKeyLast4: '0000',
      }),
      apiKey: 'global-openai-key-0000',
    });
  });

  it('omits configured providers with missing connections but explicit resolve reports the missing connection', () => {
    const settingsRepo = createSettingsRepo({
      ai_provider_catalog_v2: JSON.stringify([
        {
          id: 'provider:orphan',
          name: 'Orphan Provider',
          connectionId: 'connection:missing',
          model: 'gpt-orphan',
          protocol: 'chat-completions',
          kind: 'configured',
          createdAt: '2026-05-22T00:00:00.000Z',
          updatedAt: '2026-05-22T00:00:00.000Z',
        },
      ]),
    });
    const service = new AIProviderCatalogService(settingsRepo, createTransport());

    expect(service.listProviders()).toEqual([]);
    expect(() => service.resolveProviderConfig('provider:orphan')).toThrow(
      'AI provider connection is missing.',
    );
  });

  it('deletes configured providers and protects or deletes connections', async () => {
    const settingsRepo = createSettingsRepo();
    const service = new AIProviderCatalogService(settingsRepo, createTransport());
    const tested = await service.testConnection({
      name: 'OpenAI',
      baseUrl: 'https://example.com/v1',
      apiKey: 'secret-key-1234',
    });
    const provider = await service.addProvider({
      name: 'OpenAI / gpt-demo',
      connectionId: tested.connection!.id,
      model: 'gpt-demo',
    });

    expect(() => service.deleteConnection(tested.connection!.id, false)).toThrow(
      /Cannot delete an AI connection that has providers/,
    );
    service.deleteProvider(provider.id, false);
    expect(service.listProviders()).toEqual([]);
    expect(() => service.deleteConnection(tested.connection!.id, true)).toThrow(
      /Cannot delete an AI connection that has providers/,
    );

    service.deleteConnection(tested.connection!.id, false);
    expect(service.listConnections()).toEqual([]);
    expect(settingsRepo.dump()[`ai_connection_key::${tested.connection!.id}`]).toBeNull();
  });
});
