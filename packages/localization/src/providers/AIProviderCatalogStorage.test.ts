import { describe, expect, it } from 'vitest';
import type { SettingsRepository } from '../ports';
import { AIProviderCatalogStorage } from './AIProviderCatalogStorage';

function createSettingsRepo(seed: Record<string, string | null> = {}): SettingsRepository & {
  dump(): Record<string, string | null>;
} {
  const store = new Map<string, string | null>(Object.entries(seed));
  return {
    getSetting: (key) => store.get(key) ?? undefined,
    setSetting: (key, value) => store.set(key, value),
    dump: () => Object.fromEntries(store.entries()),
  };
}

describe('AIProviderCatalogStorage', () => {
  it('treats malformed catalogs as empty without mutating settings', () => {
    const settingsRepo = createSettingsRepo({
      ai_connection_catalog_v1: '{broken',
      ai_provider_catalog_v2: JSON.stringify({ not: 'an array' }),
      ai_provider_catalog_v1: JSON.stringify([null, { kind: 'custom' }]),
    });
    const storage = new AIProviderCatalogStorage(settingsRepo);

    expect(storage.readConnections()).toEqual([]);
    expect(storage.readProviders()).toEqual([]);
    expect(storage.readLegacyProviders()).toEqual([]);
    expect(settingsRepo.dump()).toMatchObject({
      ai_connection_catalog_v1: '{broken',
      ai_provider_catalog_v2: JSON.stringify({ not: 'an array' }),
    });
  });

  it('normalizes valid connection and provider records while dropping invalid entries', () => {
    const settingsRepo = createSettingsRepo({
      ai_connection_catalog_v1: JSON.stringify([
        { id: 'invalid' },
        {
          id: 'connection:one',
          name: ' Gateway ',
          baseUrl: 'https://gateway.example/v1///',
          protocol: 'chat-completions',
          kind: 'openai-compatible',
          apiKeyLast4: ' secret-1234 ',
          discoveredModels: [' gpt-main ', 'image-only-model', 42, 'gpt-main'],
          lastTestedAt: '2026-08-11T00:00:00.000Z',
          lastRefreshedAt: 42,
          createdAt: '2026-08-10T00:00:00.000Z',
          updatedAt: '2026-08-11T00:00:00.000Z',
        },
      ]),
      ai_provider_catalog_v2: JSON.stringify([
        { id: 'invalid' },
        {
          id: 'provider:one',
          name: ' Main ',
          connectionId: ' connection:one ',
          model: ' gpt-main ',
          protocol: 'chat-completions',
          kind: 'configured',
          createdAt: '2026-08-10T00:00:00.000Z',
          updatedAt: '2026-08-11T00:00:00.000Z',
        },
      ]),
    });
    const storage = new AIProviderCatalogStorage(settingsRepo);

    expect(storage.readConnections()).toEqual([
      {
        id: 'connection:one',
        name: 'Gateway',
        baseUrl: 'https://gateway.example/v1',
        protocol: 'chat-completions',
        kind: 'openai-compatible',
        apiKeyLast4: '1234',
        discoveredModels: ['gpt-main'],
        lastTestedAt: '2026-08-11T00:00:00.000Z',
        createdAt: '2026-08-10T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
      },
    ]);
    expect(storage.readProviders()).toEqual([
      {
        id: 'provider:one',
        name: 'Main',
        connectionId: 'connection:one',
        model: 'gpt-main',
        protocol: 'chat-completions',
        kind: 'configured',
        createdAt: '2026-08-10T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
      },
    ]);
  });

  it('keeps connection and legacy secrets in their established setting slots', () => {
    const settingsRepo = createSettingsRepo({
      'ai_provider_key::custom:legacy': 'legacy-secret',
      openai_api_key: 'global-secret',
    });
    const storage = new AIProviderCatalogStorage(settingsRepo);

    storage.setConnectionApiKey('connection:one', 'connection-secret');
    expect(storage.getConnectionApiKey('connection:one')).toBe('connection-secret');
    expect(storage.getLegacyProviderApiKey('custom:legacy')).toBe('legacy-secret');
    expect(storage.getGlobalOpenAIApiKey()).toBe('global-secret');

    storage.clearConnectionApiKey('connection:one');
    expect(settingsRepo.dump()['ai_connection_key::connection:one']).toBeNull();
  });
});
