import { randomUUID } from 'crypto';
import { normalizeProjectAIModel } from '@cat/core/project';
import type { AITransport, SettingsRepository } from '../ports';
import { filterDiscoveredModelIds } from './AIProviderModelFilter';
import {
  AIProviderCatalogStorage,
  last4,
  normalizeBaseUrl,
} from './AIProviderCatalogStorage';
import type {
  AddAIProviderInput,
  AIConnectionSummary,
  AIProviderSummary,
  AITestConnectionResult,
  LegacyCustomProvider,
  ResolvedAIProviderConfig,
  StoredAIConnection,
  StoredAIProvider,
  TestAIConnectionInput,
} from './AIProviderCatalogTypes';

export { filterDiscoveredModelIds } from './AIProviderModelFilter';
export type {
  AddAIProviderInput,
  AIConnectionSummary,
  AIProviderSummary,
  AITestConnectionResult,
  ResolvedAIProviderConfig,
  TestAIConnectionInput,
} from './AIProviderCatalogTypes';

function validateConnectionInput(input: TestAIConnectionInput): TestAIConnectionInput {
  const connectionId = input.connectionId?.trim();
  const name = input.name.trim();
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const apiKey = input.apiKey.trim();

  if (!name) throw new Error('Connection name is required');
  if (!baseUrl) throw new Error('API Base URL is required');
  if (!apiKey) throw new Error('API key is required');

  return {
    ...(connectionId ? { connectionId } : {}),
    name,
    baseUrl,
    apiKey,
  };
}

function validateProviderInput(input: AddAIProviderInput): AddAIProviderInput {
  const name = input.name.trim();
  const connectionId = input.connectionId.trim();
  const model = input.model.trim();

  if (!name) throw new Error('Provider name is required');
  if (!connectionId) throw new Error('AI provider connection is required');
  if (!model) throw new Error('Model is required');

  return { name, connectionId, model };
}

function isLegacyOrMissingProviderId(providerId: string): boolean {
  return !providerId || providerId.startsWith('builtin:openai:');
}

export class AIProviderCatalogService {
  private readonly storage: AIProviderCatalogStorage;

  constructor(
    settingsRepo: SettingsRepository,
    private readonly transport: AITransport,
  ) {
    this.storage = new AIProviderCatalogStorage(settingsRepo);
  }

  public listConnections(): AIConnectionSummary[] {
    return this.storage.readConnections().map((connection) => this.toConnectionSummary(connection));
  }

  public async testConnection(input: TestAIConnectionInput): Promise<AITestConnectionResult> {
    try {
      const normalized = validateConnectionInput(input);
      const discovery = await this.transport.listModels({
        apiKey: normalized.apiKey,
        baseUrl: normalized.baseUrl,
      });
      const discoveredModels = filterDiscoveredModelIds(discovery.models);
      if (discoveredModels.length === 0) {
        throw new Error('No usable text models were discovered.');
      }

      const now = new Date().toISOString();
      const storedConnections = this.storage.readConnections();
      const existing = normalized.connectionId
        ? storedConnections.find((connection) => connection.id === normalized.connectionId)
        : undefined;
      const connection: StoredAIConnection = {
        id: existing?.id ?? `connection:${randomUUID()}`,
        name: normalized.name,
        baseUrl: normalized.baseUrl,
        protocol: 'chat-completions',
        kind: 'openai-compatible',
        ...(last4(normalized.apiKey) ? { apiKeyLast4: last4(normalized.apiKey) } : {}),
        discoveredModels,
        lastTestedAt: now,
        lastRefreshedAt: now,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      const nextConnections = [
        ...storedConnections.filter((candidate) => candidate.id !== connection.id),
        connection,
      ];
      this.storage.setConnectionApiKey(connection.id, normalized.apiKey);
      this.storage.writeConnections(nextConnections);

      return {
        ok: true,
        connection: this.toConnectionSummary(connection),
        models: discoveredModels,
        status: discovery.status,
        endpoint: discovery.endpoint,
        rawResponseText: discovery.rawResponseText,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public listProviders(): AIProviderSummary[] {
    return [...this.readConfiguredProviderSummaries(), ...this.readLegacyProviderSummaries()];
  }

  public async addProvider(input: AddAIProviderInput): Promise<AIProviderSummary> {
    const normalized = validateProviderInput(input);
    this.assertUniqueProviderName(normalized.name);
    const connection = this.storage
      .readConnections()
      .find((candidate) => candidate.id === normalized.connectionId);
    if (!connection) throw new Error('AI provider connection is missing.');
    if (!connection.discoveredModels.includes(normalized.model)) {
      throw new Error(
        `Model "${normalized.model}" was not discovered for connection "${connection.name}".`,
      );
    }

    const apiKey = this.storage.getConnectionApiKey(connection.id);
    if (!apiKey) throw new Error(`API key is missing for connection "${connection.name}".`);

    await this.transport.testConnection({
      apiKey,
      baseUrl: connection.baseUrl,
      model: normalized.model,
    });

    const now = new Date().toISOString();
    const provider: StoredAIProvider = {
      id: `provider:${randomUUID()}`,
      name: normalized.name,
      connectionId: connection.id,
      model: normalized.model,
      protocol: 'chat-completions',
      kind: 'configured',
      createdAt: now,
      updatedAt: now,
    };
    this.storage.writeProviders([...this.storage.readProviders(), provider]);
    return this.toProviderSummary(provider, connection);
  }

  public deleteProvider(providerId: string, isInUse: boolean): void {
    if (isInUse) {
      throw new Error('Cannot delete an AI provider that is currently used by a project');
    }

    const providers = this.storage.readProviders();
    const nextProviders = providers.filter((provider) => provider.id !== providerId);
    if (nextProviders.length === providers.length) throw new Error('AI provider not found');
    this.storage.writeProviders(nextProviders);
  }

  public deleteConnection(connectionId: string, isInUse: boolean): void {
    if (
      isInUse ||
      this.storage.readProviders().some((provider) => provider.connectionId === connectionId)
    ) {
      throw new Error('Cannot delete an AI connection that has providers or is in use.');
    }

    const connections = this.storage.readConnections();
    const nextConnections = connections.filter((connection) => connection.id !== connectionId);
    if (nextConnections.length === connections.length) throw new Error('AI connection not found');

    this.storage.writeConnections(nextConnections);
    this.storage.clearConnectionApiKey(connectionId);
  }

  public resolveProviderConfig(providerId?: string | null): ResolvedAIProviderConfig {
    const storedProviders = this.storage.readProviders();
    const connectionsById = new Map(
      this.storage.readConnections().map((connection) => [connection.id, connection]),
    );
    const normalizedProviderId = normalizeProjectAIModel(providerId);
    const configuredProvider = storedProviders.find(
      (candidate) => candidate.id === normalizedProviderId,
    );
    if (configuredProvider) return this.resolveConfiguredProvider(configuredProvider, connectionsById);

    const legacyProvider = this.storage
      .readLegacyProviders()
      .find((candidate) => candidate.id === normalizedProviderId);
    if (legacyProvider) return this.resolveLegacyProvider(legacyProvider);

    const fallbackProvider = isLegacyOrMissingProviderId(normalizedProviderId)
      ? storedProviders.find((candidate) => connectionsById.has(candidate.connectionId))
      : undefined;
    if (!fallbackProvider) throw new Error('AI provider is not configured.');

    return this.resolveConfiguredProvider(fallbackProvider, connectionsById);
  }

  private assertUniqueProviderName(name: string): void {
    const loweredName = name.trim().toLowerCase();
    const exists = this.listProviders().some(
      (provider) => provider.name.trim().toLowerCase() === loweredName,
    );
    if (exists) throw new Error(`AI provider name "${name}" already exists`);
  }

  private readConfiguredProviderSummaries(): AIProviderSummary[] {
    const connectionsById = new Map(
      this.storage.readConnections().map((connection) => [connection.id, connection]),
    );
    return this.storage.readProviders().flatMap((provider) => {
      const connection = connectionsById.get(provider.connectionId);
      return connection ? [this.toProviderSummary(provider, connection)] : [];
    });
  }

  private readLegacyProviderSummaries(): AIProviderSummary[] {
    const globalKeyLast4 = last4(this.storage.getGlobalOpenAIApiKey());
    return this.storage.readLegacyProviders().map((provider) => {
      const apiKeyLast4 =
        last4(this.storage.getLegacyProviderApiKey(provider.id)) ??
        globalKeyLast4 ??
        provider.apiKeyLast4;
      return this.toLegacyProviderSummary(provider, apiKeyLast4);
    });
  }

  private toConnectionSummary(connection: StoredAIConnection): AIConnectionSummary {
    return {
      id: connection.id,
      name: connection.name,
      baseUrl: connection.baseUrl,
      protocol: connection.protocol,
      kind: connection.kind,
      ...(connection.apiKeyLast4 ? { apiKeyLast4: connection.apiKeyLast4 } : {}),
      discoveredModels: [...connection.discoveredModels],
      ...(connection.lastTestedAt ? { lastTestedAt: connection.lastTestedAt } : {}),
      ...(connection.lastRefreshedAt ? { lastRefreshedAt: connection.lastRefreshedAt } : {}),
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    };
  }

  private toProviderSummary(
    provider: StoredAIProvider,
    connection?: StoredAIConnection,
  ): AIProviderSummary {
    const apiKeyLast4 =
      last4(connection ? this.storage.getConnectionApiKey(connection.id) : undefined) ??
      connection?.apiKeyLast4;

    return {
      id: provider.id,
      name: provider.name,
      baseUrl: connection?.baseUrl ?? '',
      model: provider.model,
      protocol: provider.protocol,
      kind: 'configured',
      connectionId: provider.connectionId,
      connectionName: connection?.name ?? '',
      ...(apiKeyLast4 ? { apiKeyLast4 } : {}),
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt,
    };
  }

  private toLegacyProviderSummary(
    provider: LegacyCustomProvider,
    apiKeyLast4?: string,
  ): AIProviderSummary {
    return {
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      model: provider.model,
      protocol: provider.protocol,
      kind: 'legacy',
      connectionId: `legacy:connection:${provider.id}`,
      connectionName: provider.name,
      ...(apiKeyLast4 ? { apiKeyLast4 } : {}),
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt,
    };
  }

  private resolveConfiguredProvider(
    provider: StoredAIProvider,
    connectionsById: Map<string, StoredAIConnection>,
  ): ResolvedAIProviderConfig {
    const connection = connectionsById.get(provider.connectionId);
    if (!connection) throw new Error('AI provider connection is missing.');

    const apiKey = this.storage.getConnectionApiKey(connection.id);
    if (!apiKey) throw new Error(`API key is missing for connection "${connection.name}".`);

    return { provider: this.toProviderSummary(provider, connection), apiKey };
  }

  private resolveLegacyProvider(provider: LegacyCustomProvider): ResolvedAIProviderConfig {
    const apiKey =
      this.storage.getLegacyProviderApiKey(provider.id) ?? this.storage.getGlobalOpenAIApiKey();
    if (!apiKey) throw new Error(`API key is missing for legacy provider "${provider.name}".`);

    return {
      provider: this.toLegacyProviderSummary(provider, last4(apiKey)),
      apiKey,
    };
  }
}
