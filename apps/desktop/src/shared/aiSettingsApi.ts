export interface AISettings {
  apiKeySet: boolean;
  apiKeyLast4?: string;
}

export type AIProviderKind = 'configured' | 'legacy';
export type AIConnectionKind = 'openai-compatible';
export type AIProviderProtocol = 'chat-completions';

export interface AIConnectionSummary {
  id: string;
  name: string;
  baseUrl: string;
  protocol: AIProviderProtocol;
  kind: AIConnectionKind;
  apiKeyLast4?: string;
  discoveredModels: string[];
  lastTestedAt?: string;
  lastRefreshedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AIProviderSummary {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  protocol: AIProviderProtocol;
  kind: AIProviderKind;
  connectionId: string;
  connectionName: string;
  apiKeyLast4?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TestAIConnectionInput {
  connectionId?: string;
  name: string;
  baseUrl: string;
  apiKey: string;
}

export interface AITestConnectionResult {
  ok: boolean;
  connection?: AIConnectionSummary;
  models?: string[];
  error?: string;
  status?: number;
  endpoint?: string;
  rawResponseText?: string;
}

export interface AddAIProviderInput {
  name: string;
  connectionId: string;
  model: string;
}

export type ProxyMode = 'off' | 'system' | 'custom';

export interface ProxySettings {
  mode: ProxyMode;
  customProxyUrl: string;
  effectiveProxyUrl?: string;
}

export interface ProxySettingsInput {
  mode: ProxyMode;
  customProxyUrl?: string;
}

export interface SourceTerminologyPromptPreset {
  id: string;
  name: string;
  prompt: string;
  isBuiltin: boolean;
}

export interface SourceTerminologyPromptSettings {
  prompt: string;
  activePromptId: string;
  prompts: SourceTerminologyPromptPreset[];
  maxChars: number;
  maxNameChars: number;
  loadWarning?: string;
}

export type SourceTerminologyPromptSettingsInput =
  | { action: 'create'; name: string; prompt: string }
  | { action: 'update'; promptId: string; name: string; prompt: string }
  | { action: 'delete'; promptId: string }
  | { action: 'activate'; promptId: string };

export interface AISettingsApi {
  getAISettings: () => Promise<AISettings>;
  listAIConnections: () => Promise<AIConnectionSummary[]>;
  testAIConnection: (input: TestAIConnectionInput) => Promise<AITestConnectionResult>;
  deleteAIConnection: (connectionId: string) => Promise<void>;
  listAIProviders: () => Promise<AIProviderSummary[]>;
  addAIProvider: (input: AddAIProviderInput) => Promise<AIProviderSummary>;
  deleteAIProvider: (providerId: string) => Promise<void>;
  getProxySettings: () => Promise<ProxySettings>;
  setProxySettings: (settings: ProxySettingsInput) => Promise<ProxySettings>;
  getSourceTerminologyPromptSettings: () => Promise<SourceTerminologyPromptSettings>;
  setSourceTerminologyPromptSettings: (
    input: SourceTerminologyPromptSettingsInput,
  ) => Promise<SourceTerminologyPromptSettings>;
}
