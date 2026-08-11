import type { SettingsRepository } from '../ports';
import { filterDiscoveredModelIds } from './AIProviderModelFilter';
import type {
  AIConnectionSummary,
  LegacyCustomProvider,
  StoredAIConnection,
  StoredAIProvider,
} from './AIProviderCatalogTypes';

const CONNECTION_CATALOG_KEY = 'ai_connection_catalog_v1';
const PROVIDER_CATALOG_KEY = 'ai_provider_catalog_v2';
const LEGACY_PROVIDER_CATALOG_KEY = 'ai_provider_catalog_v1';
const CONNECTION_KEY_PREFIX = 'ai_connection_key::';
const LEGACY_PROVIDER_KEY_PREFIX = 'ai_provider_key::';
const OPENAI_API_KEY = 'openai_api_key';

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function last4(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(-4) : undefined;
}

function optionalLast4(
  apiKeyLast4: string | undefined,
): Pick<AIConnectionSummary, 'apiKeyLast4'> {
  const value = last4(apiKeyLast4);
  return value ? { apiKeyLast4: value } : {};
}

function optionalTimestamp<TName extends 'lastTestedAt' | 'lastRefreshedAt'>(
  name: TName,
  value: unknown,
): Partial<Pick<AIConnectionSummary, TName>> {
  return typeof value === 'string'
    ? ({ [name]: value } as Pick<AIConnectionSummary, TName>)
    : {};
}

export class AIProviderCatalogStorage {
  constructor(private readonly settingsRepo: SettingsRepository) {}

  public readConnections(): StoredAIConnection[] {
    const raw = this.settingsRepo.getSetting(CONNECTION_CATALOG_KEY);
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((value): value is StoredAIConnection => {
          if (!value || typeof value !== 'object') return false;
          const connection = value as Partial<StoredAIConnection>;
          return (
            connection.kind === 'openai-compatible' &&
            connection.protocol === 'chat-completions' &&
            typeof connection.id === 'string' &&
            typeof connection.name === 'string' &&
            typeof connection.baseUrl === 'string' &&
            Array.isArray(connection.discoveredModels) &&
            typeof connection.createdAt === 'string' &&
            typeof connection.updatedAt === 'string'
          );
        })
        .map((connection) => ({
          id: connection.id,
          name: connection.name.trim(),
          baseUrl: normalizeBaseUrl(connection.baseUrl),
          protocol: 'chat-completions',
          kind: 'openai-compatible',
          ...optionalLast4(connection.apiKeyLast4),
          discoveredModels: filterDiscoveredModelIds(
            connection.discoveredModels.filter(
              (model): model is string => typeof model === 'string',
            ),
          ),
          ...optionalTimestamp('lastTestedAt', connection.lastTestedAt),
          ...optionalTimestamp('lastRefreshedAt', connection.lastRefreshedAt),
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
        }));
    } catch {
      return [];
    }
  }

  public writeConnections(connections: StoredAIConnection[]): void {
    this.settingsRepo.setSetting(CONNECTION_CATALOG_KEY, JSON.stringify(connections));
  }

  public readProviders(): StoredAIProvider[] {
    const raw = this.settingsRepo.getSetting(PROVIDER_CATALOG_KEY);
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((value): value is StoredAIProvider => {
          if (!value || typeof value !== 'object') return false;
          const provider = value as Partial<StoredAIProvider>;
          return (
            provider.kind === 'configured' &&
            provider.protocol === 'chat-completions' &&
            typeof provider.id === 'string' &&
            typeof provider.name === 'string' &&
            typeof provider.connectionId === 'string' &&
            typeof provider.model === 'string' &&
            typeof provider.createdAt === 'string' &&
            typeof provider.updatedAt === 'string'
          );
        })
        .map((provider) => ({
          id: provider.id,
          name: provider.name.trim(),
          connectionId: provider.connectionId.trim(),
          model: provider.model.trim(),
          protocol: 'chat-completions',
          kind: 'configured',
          createdAt: provider.createdAt,
          updatedAt: provider.updatedAt,
        }));
    } catch {
      return [];
    }
  }

  public writeProviders(providers: StoredAIProvider[]): void {
    this.settingsRepo.setSetting(PROVIDER_CATALOG_KEY, JSON.stringify(providers));
  }

  public readLegacyProviders(): LegacyCustomProvider[] {
    const raw = this.settingsRepo.getSetting(LEGACY_PROVIDER_CATALOG_KEY);
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((value): value is LegacyCustomProvider => {
          if (!value || typeof value !== 'object') return false;
          const provider = value as Partial<LegacyCustomProvider>;
          return (
            provider.kind === 'custom' &&
            provider.protocol === 'chat-completions' &&
            typeof provider.id === 'string' &&
            typeof provider.name === 'string' &&
            typeof provider.baseUrl === 'string' &&
            typeof provider.model === 'string' &&
            typeof provider.createdAt === 'string' &&
            typeof provider.updatedAt === 'string'
          );
        })
        .map((provider) => ({
          id: provider.id,
          name: provider.name.trim(),
          baseUrl: normalizeBaseUrl(provider.baseUrl),
          model: provider.model.trim(),
          protocol: 'chat-completions',
          kind: 'custom',
          ...(provider.apiKeyLast4 ? { apiKeyLast4: provider.apiKeyLast4 } : {}),
          createdAt: provider.createdAt,
          updatedAt: provider.updatedAt,
        }));
    } catch {
      return [];
    }
  }

  public getConnectionApiKey(connectionId: string): string | undefined {
    return this.settingsRepo.getSetting(`${CONNECTION_KEY_PREFIX}${connectionId}`);
  }

  public setConnectionApiKey(connectionId: string, apiKey: string): void {
    this.settingsRepo.setSetting(`${CONNECTION_KEY_PREFIX}${connectionId}`, apiKey);
  }

  public clearConnectionApiKey(connectionId: string): void {
    this.settingsRepo.setSetting(`${CONNECTION_KEY_PREFIX}${connectionId}`, null);
  }

  public getLegacyProviderApiKey(providerId: string): string | undefined {
    return this.settingsRepo.getSetting(`${LEGACY_PROVIDER_KEY_PREFIX}${providerId}`);
  }

  public getGlobalOpenAIApiKey(): string | undefined {
    return this.settingsRepo.getSetting(OPENAI_API_KEY);
  }
}
