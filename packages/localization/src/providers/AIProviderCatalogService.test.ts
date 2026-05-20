import { describe, expect, it, vi } from 'vitest';
import { AIProviderCatalogService } from './AIProviderCatalogService';
import type { AITransport, SettingsRepository } from '../ports';

class InMemorySettingsRepository implements SettingsRepository {
  public readonly setSetting = vi.fn((key: string, value: string | null) => {
    if (value === null) {
      this.values.delete(key);
      return;
    }

    this.values.set(key, value);
  });

  private readonly values = new Map<string, string>();

  public getSetting(key: string): string | undefined {
    return this.values.get(key);
  }
}

describe('AIProviderCatalogService', () => {
  it('stores provider api keys before adding providers to the catalog', () => {
    const settingsRepo = new InMemorySettingsRepository();
    const transport = {
      testConnection: vi.fn(),
      createResponse: vi.fn(),
    } as unknown as AITransport;
    const service = new AIProviderCatalogService(settingsRepo, transport);

    const provider = service.addProvider({
      name: 'Custom Provider',
      baseUrl: 'https://example.com/v1',
      apiKey: 'secret-key',
      model: 'gpt-demo',
    });

    const calls = settingsRepo.setSetting.mock.calls;
    expect(calls[0]).toEqual([`ai_provider_key::${provider.id}`, 'secret-key']);
    expect(calls[1]?.[0]).toBe('ai_provider_catalog_v1');
  });
});
