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

export interface StoredAIConnection extends AIConnectionSummary {}

export interface StoredAIProvider {
  id: string;
  name: string;
  connectionId: string;
  model: string;
  protocol: 'chat-completions';
  kind: 'configured';
  createdAt: string;
  updatedAt: string;
}

export interface LegacyCustomProvider {
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
