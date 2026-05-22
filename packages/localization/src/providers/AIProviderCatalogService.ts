import { randomUUID } from 'crypto';
import { normalizeProjectAIModel } from '@cat/core/project';
import type { AITransport, SettingsRepository } from '../ports';

const CONNECTION_CATALOG_KEY = 'ai_connection_catalog_v1';
const PROVIDER_CATALOG_KEY = 'ai_provider_catalog_v2';
const LEGACY_PROVIDER_CATALOG_KEY = 'ai_provider_catalog_v1';
const CONNECTION_KEY_PREFIX = 'ai_connection_key::';
const LEGACY_PROVIDER_KEY_PREFIX = 'ai_provider_key::';
const OPENAI_API_KEY = 'openai_api_key';

export interface TestAIConnectionInput {
  connectionId?: string;
  name: string;
  baseUrl: string;
  apiKey: string;
}

export interface AIConnectionSummary {
  id: string;
  name: string;
  baseUrl: string;
  protocol: 'chat-completions';
  kind: 'openai-compatible';
  apiKeyLast4?: string;
  discoveredModels: string[];
  lastTestedAt?: string;
  lastRefreshedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AITestConnectionResult {
  ok: boolean;
  connection?: AIConnectionSummary;
  models?: string[];
  status?: number;
  endpoint?: string;
  rawResponseText?: string;
  error?: string;
}

export interface AddAIProviderInput {
  name: string;
  connectionId: string;
  model: string;
}

export interface AIProviderSummary {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  protocol: 'chat-completions';
  kind: 'configured' | 'legacy';
  connectionId: string;
  connectionName: string;
  apiKeyLast4?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedAIProviderConfig {
  provider: AIProviderSummary;
  apiKey: string;
}

interface StoredAIConnection extends AIConnectionSummary {}

interface StoredAIProvider {
  id: string;
  name: string;
  connectionId: string;
  model: string;
  protocol: 'chat-completions';
  kind: 'configured';
  createdAt: string;
  updatedAt: string;
}

interface LegacyCustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  protocol: 'chat-completions';
  kind: 'custom';
  apiKeyLast4?: string;
  createdAt: string;
  updatedAt: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function last4(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(-4) : undefined;
}

function validateConnectionInput(input: TestAIConnectionInput): TestAIConnectionInput {
  const connectionId = input.connectionId?.trim();
  const name = input.name.trim();
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const apiKey = input.apiKey.trim();

  if (!name) {
    throw new Error('Connection name is required');
  }

  if (!baseUrl) {
    throw new Error('API Base URL is required');
  }

  if (!apiKey) {
    throw new Error('API key is required');
  }

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

  if (!name) {
    throw new Error('Provider name is required');
  }

  if (!connectionId) {
    throw new Error('AI provider connection is required');
  }

  if (!model) {
    throw new Error('Model is required');
  }

  return {
    name,
    connectionId,
    model,
  };
}

function isLegacyOrMissingProviderId(providerId: string): boolean {
  return !providerId || providerId.startsWith('builtin:openai:');
}

export function filterDiscoveredModelIds(models: string[]): string[] {
  const denyPatterns = [
    /embedding/i,
    /\bembed\b/i,
    /audio/i,
    /tts/i,
    /whisper/i,
    /image/i,
    /image-only/i,
    /vision-image/i,
  ];
  const seen = new Set<string>();
  const filtered: string[] = [];

  for (const rawModel of models) {
    const model = rawModel.trim();
    if (!model || seen.has(model)) {
      continue;
    }
    if (denyPatterns.some((pattern) => pattern.test(model))) {
      continue;
    }
    seen.add(model);
    filtered.push(model);
  }

  return filtered;
}

export class AIProviderCatalogService {
  constructor(
    private readonly settingsRepo: SettingsRepository,
    private readonly transport: AITransport,
  ) {}

  public listConnections(): AIConnectionSummary[] {
    return this.readStoredConnections().map((connection) => this.toConnectionSummary(connection));
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
      const storedConnections = this.readStoredConnections();
      const existing = normalized.connectionId
        ? storedConnections.find((connection) => connection.id === normalized.connectionId)
        : undefined;
      const connection: StoredAIConnection = {
        id: existing?.id ?? `connection:${randomUUID()}`,
        name: normalized.name,
        baseUrl: normalized.baseUrl,
        protocol: 'chat-completions',
        kind: 'openai-compatible',
        ...this.optionalLast4(normalized.apiKey),
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
      this.settingsRepo.setSetting(this.buildConnectionKey(connection.id), normalized.apiKey);
      this.writeStoredConnections(nextConnections);

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
    return [
      ...this.readConfiguredProviderSummaries(),
      ...this.readLegacyProviderSummaries(),
    ];
  }

  public async addProvider(input: AddAIProviderInput): Promise<AIProviderSummary> {
    const normalized = validateProviderInput(input);
    this.assertUniqueProviderName(normalized.name);
    const connection = this.readStoredConnections().find(
      (candidate) => candidate.id === normalized.connectionId,
    );
    if (!connection) {
      throw new Error('AI provider connection is missing.');
    }
    if (!connection.discoveredModels.includes(normalized.model)) {
      throw new Error(
        `Model "${normalized.model}" was not discovered for connection "${connection.name}".`,
      );
    }

    const apiKey = this.settingsRepo.getSetting(this.buildConnectionKey(connection.id));
    if (!apiKey) {
      throw new Error(`API key is missing for connection "${connection.name}".`);
    }

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
    this.writeStoredProviders([...this.readStoredProviders(), provider]);
    return this.toProviderSummary(provider, connection);
  }

  public deleteProvider(providerId: string, isInUse: boolean): void {
    if (isInUse) {
      throw new Error('Cannot delete an AI provider that is currently used by a project');
    }

    const providers = this.readStoredProviders();
    const nextProviders = providers.filter((provider) => provider.id !== providerId);
    if (nextProviders.length === providers.length) {
      throw new Error('AI provider not found');
    }

    this.writeStoredProviders(nextProviders);
  }

  public deleteConnection(connectionId: string, isInUse: boolean): void {
    if (
      isInUse ||
      this.readStoredProviders().some((provider) => provider.connectionId === connectionId)
    ) {
      throw new Error('Cannot delete an AI connection that has providers or is in use.');
    }

    const connections = this.readStoredConnections();
    const nextConnections = connections.filter((connection) => connection.id !== connectionId);
    if (nextConnections.length === connections.length) {
      throw new Error('AI connection not found');
    }

    this.writeStoredConnections(nextConnections);
    this.settingsRepo.setSetting(this.buildConnectionKey(connectionId), null);
  }

  public resolveProviderConfig(providerId?: string | null): ResolvedAIProviderConfig {
    const storedProviders = this.readStoredProviders();
    const normalizedProviderId = normalizeProjectAIModel(providerId);
    const provider =
      storedProviders.find((candidate) => candidate.id === normalizedProviderId) ??
      (isLegacyOrMissingProviderId(normalizedProviderId) ? storedProviders[0] : undefined);

    if (!provider) {
      throw new Error('AI provider is not configured.');
    }

    const connection = this.readStoredConnections().find(
      (candidate) => candidate.id === provider.connectionId,
    );
    if (!connection) {
      throw new Error('AI provider connection is missing.');
    }

    const apiKey = this.settingsRepo.getSetting(this.buildConnectionKey(connection.id));
    if (!apiKey) {
      throw new Error(`API key is missing for connection "${connection.name}".`);
    }

    return {
      provider: this.toProviderSummary(provider, connection),
      apiKey,
    };
  }

  private assertUniqueProviderName(name: string): void {
    const loweredName = name.trim().toLowerCase();
    const exists = this.listProviders().some(
      (provider) => provider.name.trim().toLowerCase() === loweredName,
    );
    if (exists) {
      throw new Error(`AI provider name "${name}" already exists`);
    }
  }

  private readStoredConnections(): StoredAIConnection[] {
    const raw = this.settingsRepo.getSetting(CONNECTION_CATALOG_KEY);
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .filter((value): value is StoredAIConnection => {
          if (!value || typeof value !== 'object') {
            return false;
          }
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
          ...this.optionalLast4(connection.apiKeyLast4),
          discoveredModels: filterDiscoveredModelIds(
            connection.discoveredModels.filter(
              (model): model is string => typeof model === 'string',
            ),
          ),
          ...this.optionalTimestamp('lastTestedAt', connection.lastTestedAt),
          ...this.optionalTimestamp('lastRefreshedAt', connection.lastRefreshedAt),
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
        }));
    } catch {
      return [];
    }
  }

  private writeStoredConnections(connections: StoredAIConnection[]): void {
    this.settingsRepo.setSetting(CONNECTION_CATALOG_KEY, JSON.stringify(connections));
  }

  private readStoredProviders(): StoredAIProvider[] {
    const raw = this.settingsRepo.getSetting(PROVIDER_CATALOG_KEY);
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .filter((value): value is StoredAIProvider => {
          if (!value || typeof value !== 'object') {
            return false;
          }
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

  private writeStoredProviders(providers: StoredAIProvider[]): void {
    this.settingsRepo.setSetting(PROVIDER_CATALOG_KEY, JSON.stringify(providers));
  }

  private readConfiguredProviderSummaries(): AIProviderSummary[] {
    const connectionsById = new Map(
      this.readStoredConnections().map((connection) => [connection.id, connection]),
    );
    return this.readStoredProviders().map((provider) =>
      this.toProviderSummary(provider, connectionsById.get(provider.connectionId)),
    );
  }

  private readLegacyProviderSummaries(): AIProviderSummary[] {
    const raw = this.settingsRepo.getSetting(LEGACY_PROVIDER_CATALOG_KEY);
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      const globalKeyLast4 = last4(this.settingsRepo.getSetting(OPENAI_API_KEY));
      return parsed
        .filter((value): value is LegacyCustomProvider => {
          if (!value || typeof value !== 'object') {
            return false;
          }
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
        .map((provider) => {
          const apiKeyLast4 =
            last4(this.settingsRepo.getSetting(this.buildLegacyProviderKey(provider.id))) ??
            provider.apiKeyLast4 ??
            globalKeyLast4;
          return {
            id: provider.id,
            name: provider.name,
            baseUrl: normalizeBaseUrl(provider.baseUrl),
            model: provider.model,
            protocol: 'chat-completions' as const,
            kind: 'legacy' as const,
            connectionId: `legacy:connection:${provider.id}`,
            connectionName: provider.name,
            ...(apiKeyLast4 ? { apiKeyLast4 } : {}),
            createdAt: provider.createdAt,
            updatedAt: provider.updatedAt,
          };
        });
    } catch {
      return [];
    }
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
      last4(
        connection ? this.settingsRepo.getSetting(this.buildConnectionKey(connection.id)) : undefined,
      ) ?? connection?.apiKeyLast4;

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

  private optionalLast4(apiKeyLast4: string | undefined): Pick<AIConnectionSummary, 'apiKeyLast4'> {
    const value = last4(apiKeyLast4);
    return value ? { apiKeyLast4: value } : {};
  }

  private optionalTimestamp<TName extends 'lastTestedAt' | 'lastRefreshedAt'>(
    name: TName,
    value: unknown,
  ): Pick<AIConnectionSummary, TName> {
    return typeof value === 'string' ? { [name]: value } as Pick<AIConnectionSummary, TName> : {};
  }

  private buildConnectionKey(connectionId: string): string {
    return `${CONNECTION_KEY_PREFIX}${connectionId}`;
  }

  private buildLegacyProviderKey(providerId: string): string {
    return `${LEGACY_PROVIDER_KEY_PREFIX}${providerId}`;
  }
}
