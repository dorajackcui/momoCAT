import { randomUUID } from 'crypto';
import {
  DEFAULT_PROJECT_AI_MODEL,
  type BuiltinOpenAIProviderId,
  PROJECT_AI_MODELS,
  getBuiltinOpenAIProviderModel,
  normalizeProjectAIModel,
} from '@cat/core/project';
import type {
  AddAIProviderInput,
  AIProviderSummary,
  AITestProviderResult,
  TestAIProviderInput,
} from '../../../../shared/ipc';
import type { AITransport, SettingsRepository } from '../../ports';
import { AISettingsService } from './AISettingsService';

const PROVIDER_CATALOG_KEY = 'ai_provider_catalog_v1';
const PROVIDER_KEY_PREFIX = 'ai_provider_key::';
const BUILTIN_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const BUILTIN_PROVIDER_TIMESTAMP = '1970-01-01T00:00:00.000Z';

interface StoredCustomProvider {
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

export interface ResolvedAIProviderConfig {
  provider: AIProviderSummary;
  apiKey: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function buildBuiltinProvider(
  providerId: BuiltinOpenAIProviderId,
  apiKeyLast4?: string,
): AIProviderSummary {
  const model = getBuiltinOpenAIProviderModel(providerId);
  if (!model) {
    throw new Error(`Unknown builtin provider: ${providerId}`);
  }

  return {
    id: providerId,
    name: `OpenAI / ${model}`,
    baseUrl: BUILTIN_OPENAI_BASE_URL,
    model,
    protocol: 'chat-completions',
    kind: 'builtin',
    apiKeyLast4,
    createdAt: BUILTIN_PROVIDER_TIMESTAMP,
    updatedAt: BUILTIN_PROVIDER_TIMESTAMP,
  };
}

function validateProviderInput(input: TestAIProviderInput): AddAIProviderInput {
  const name = input.name.trim();
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const apiKey = input.apiKey.trim();
  const model = input.model.trim();

  if (!name) {
    throw new Error('Provider name is required');
  }

  if (!baseUrl) {
    throw new Error('API Base URL is required');
  }

  if (!apiKey) {
    throw new Error('API key is required');
  }

  if (!model) {
    throw new Error('Model is required');
  }

  return {
    name,
    baseUrl,
    apiKey,
    model,
  };
}

export class AIProviderCatalogService {
  constructor(
    private readonly settingsRepo: SettingsRepository,
    private readonly transport: AITransport,
  ) {}

  public listProviders(): AIProviderSummary[] {
    const globalKey = this.settingsRepo.getSetting(AISettingsService.AI_API_KEY);
    const apiKeyLast4 = globalKey ? globalKey.slice(-4) : undefined;
    const builtinProviders = PROJECT_AI_MODELS.map((providerId: BuiltinOpenAIProviderId) =>
      buildBuiltinProvider(providerId, apiKeyLast4),
    );

    return [...builtinProviders, ...this.readCustomProviders()];
  }

  public async testProvider(input: TestAIProviderInput): Promise<AITestProviderResult> {
    try {
      const normalized = validateProviderInput(input);
      const result = await this.transport.testConnection({
        apiKey: normalized.apiKey,
        baseUrl: normalized.baseUrl,
        model: normalized.model,
      });

      return {
        ok: true,
        status: result.status,
        endpoint: result.endpoint,
        model: normalized.model,
        rawResponseText: result.rawResponseText,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public addProvider(input: AddAIProviderInput): AIProviderSummary {
    const normalized = validateProviderInput(input);
    this.assertUniqueProviderName(normalized.name);

    const now = new Date().toISOString();
    const provider: StoredCustomProvider = {
      id: `custom:${randomUUID()}`,
      name: normalized.name,
      baseUrl: normalized.baseUrl,
      model: normalized.model,
      protocol: 'chat-completions',
      kind: 'custom',
      apiKeyLast4: normalized.apiKey.slice(-4),
      createdAt: now,
      updatedAt: now,
    };

    const providers = this.readCustomProviders();
    providers.push(provider);
    this.writeCustomProviders(providers);
    this.settingsRepo.setSetting(this.buildProviderKey(provider.id), normalized.apiKey);

    return provider;
  }

  public deleteProvider(providerId: string, isInUse: boolean): void {
    if (PROJECT_AI_MODELS.includes(providerId as (typeof PROJECT_AI_MODELS)[number])) {
      throw new Error('Builtin AI providers cannot be deleted');
    }

    if (isInUse) {
      throw new Error('Cannot delete an AI provider that is currently used by a project');
    }

    const providers = this.readCustomProviders();
    const nextProviders = providers.filter((provider) => provider.id !== providerId);
    if (nextProviders.length === providers.length) {
      throw new Error('AI provider not found');
    }

    this.writeCustomProviders(nextProviders);
    this.settingsRepo.setSetting(this.buildProviderKey(providerId), null);
  }

  public resolveProviderConfig(providerId?: string | null): ResolvedAIProviderConfig {
    const normalizedProviderId = normalizeProjectAIModel(providerId);
    const providers = this.listProviders();
    const provider =
      providers.find((candidate) => candidate.id === normalizedProviderId) ??
      providers.find((candidate) => candidate.id === DEFAULT_PROJECT_AI_MODEL);

    if (!provider) {
      throw new Error('No AI providers are available');
    }

    const apiKey =
      provider.kind === 'builtin'
        ? this.settingsRepo.getSetting(AISettingsService.AI_API_KEY)
        : this.settingsRepo.getSetting(this.buildProviderKey(provider.id));

    if (!apiKey) {
      throw new Error(
        provider.kind === 'builtin'
          ? 'AI API key is not configured'
          : `API key is missing for provider "${provider.name}"`,
      );
    }

    return { provider, apiKey };
  }

  private assertUniqueProviderName(name: string): void {
    const loweredName = name.trim().toLowerCase();
    const exists = this.listProviders().some((provider) => provider.name.trim().toLowerCase() === loweredName);
    if (exists) {
      throw new Error(`AI provider name "${name}" already exists`);
    }
  }

  private readCustomProviders(): StoredCustomProvider[] {
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
        .filter((value): value is StoredCustomProvider => {
          if (!value || typeof value !== 'object') {
            return false;
          }

          const provider = value as Partial<StoredCustomProvider>;
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
          ...provider,
          baseUrl: normalizeBaseUrl(provider.baseUrl),
        }));
    } catch {
      return [];
    }
  }

  private writeCustomProviders(providers: StoredCustomProvider[]): void {
    this.settingsRepo.setSetting(PROVIDER_CATALOG_KEY, JSON.stringify(providers));
  }

  private buildProviderKey(providerId: string): string {
    return `${PROVIDER_KEY_PREFIX}${providerId}`;
  }
}
