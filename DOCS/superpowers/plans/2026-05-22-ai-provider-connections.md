# AI Provider Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hard-coded built-in OpenAI model providers with reusable OpenAI-compatible connections and model-specific configured providers.

**Architecture:** `@cat/localization` owns the provider catalog implementation, including connection storage, model discovery, provider creation, runtime resolution, and compatibility reads. Desktop main reuses that implementation instead of maintaining a divergent copy. The renderer Settings modal manages connections and provider creation; Project AI settings only select already configured providers.

**Tech Stack:** TypeScript, Electron IPC, React, Vitest, SQLite-backed `app_settings`, OpenAI-compatible `/models` and `/chat/completions` HTTP endpoints.

---

## Implementation Note

The approved design said to call `/chat/completions` before `/models`, but the new flow intentionally avoids asking users for a model before discovery. The executable sequence should therefore be:

1. `Test Connection` calls `GET ${baseUrl}/models` with the supplied key.
2. The app lightly filters discovered model ids and saves the connection only when at least one model remains.
3. `Add Provider` validates the selected model with a minimal `POST ${baseUrl}/chat/completions` request before saving `connectionId + model + provider name`.

This preserves the intent of "test before saving" without reintroducing a hard-coded probe model.

## File Structure

Create and modify these files.

`packages/core/src/project/aiModelRegistry.ts`

- Remove the fixed built-in OpenAI model catalog as a runtime source of truth.
- Keep `ProjectAIModel` as `string`.
- Make normalization trim arbitrary configured provider ids and fall back to an empty string for missing values.

`packages/core/src/project/index.ts`

- Stop exporting removed built-in model catalog symbols.
- Continue exporting `DEFAULT_PROJECT_AI_MODEL`, `ProjectAIModel`, `isProjectAIModel`, and `normalizeProjectAIModel`.

`packages/core/src/project/index.test.ts`

- Update normalization expectations so old model strings and provider ids are preserved as plain ids instead of mapped to built-ins.

`packages/localization/src/ports.ts`

- Add `AITransport.listModels`.

`packages/localization/src/providers/AIProviderTransport.ts`

- Add `GET /models` support with redacted errors.

`packages/localization/src/providers/AIProviderTransport.test.ts`

- Cover model list parsing and sanitized model-list failures.

`packages/localization/src/providers/AIProviderCatalogService.ts`

- Replace v1 provider-only catalog behavior with connection catalog plus provider v2 catalog.
- Preserve old custom provider and global OpenAI key compatibility reads.
- Resolve old built-in ids to the first configured provider, or throw a setup error.

`packages/localization/src/providers/AIProviderCatalogService.test.ts`

- Cover connection creation, model filtering, provider creation, deletion protections, compatibility, and runtime resolution.

`packages/localization/src/index.ts`

- Export the new connection/provider public types.

`apps/desktop/src/main/services/modules/ai/AIProviderCatalogService.ts`

- Replace the duplicated implementation with a re-export from `@cat/localization`.

`apps/desktop/src/main/services/modules/ai/AIProviderCatalogService.test.ts`

- Convert the test to validate the desktop import path uses the shared implementation and no longer lists four built-ins.

`apps/desktop/src/main/services/ports.ts`

- Add `AITransport.listModels`.

`apps/desktop/src/main/services/providers/AIProviderTransport.ts`

- Re-export `AIProviderTransport` from `@cat/localization` so desktop and
  headless transport behavior cannot diverge.

`apps/desktop/src/main/services/providers/AIProviderTransport.test.ts`

- Cover the desktop transport import path for `listModels`.

`apps/desktop/src/shared/ipc.ts`

- Add `AIConnectionSummary`, `TestAIConnectionInput`, `AITestConnectionResult`, and update `AddAIProviderInput`.
- Extend `DesktopApi` with `listAIConnections`, `testAIConnection(input)`, and `deleteAIConnection`.

`apps/desktop/src/shared/ipcChannels.ts`

- Add IPC channel constants for listing, testing, and deleting AI connections.

`apps/desktop/src/preload/api/aiApi.ts`

- Expose the new connection methods.

`apps/desktop/src/preload/api/createDesktopApi.test.ts`

- Verify IPC routing for connection methods and updated provider input.

`apps/desktop/src/main/ipc/aiHandlers.ts`

- Register connection IPC handlers and update the existing test connection handler signature.

`apps/desktop/src/main/services/modules/AIModule.ts`

- Add connection methods and update provider creation to accept `connectionId + model`.

`apps/desktop/src/main/services/ProjectService.ts`

- Surface the new AIModule methods.

`apps/desktop/src/renderer/src/components/SettingsModal.tsx`

- Replace the OpenAI Key and Custom Providers tabs with connection-backed provider management.
- Keep Proxy tab.

`apps/desktop/src/renderer/src/components/SettingsModal.test.tsx`

- Cover connection test, model discovery, provider creation from a discovered model, connection deletion protection messaging, and provider deletion.

`apps/desktop/src/renderer/src/hooks/projectDetail/ai/aiSettingsHelpers.ts`

- Update provider selection fallback so missing configured providers do not silently select the old built-in default.

`apps/desktop/src/renderer/src/hooks/projectDetail/useProjectAI.ts`

- Track unavailable provider state and no-provider state.

`apps/desktop/src/renderer/src/hooks/projectDetail/ai/types.ts`

- Add controller fields for provider availability warnings.

`apps/desktop/src/renderer/src/components/project-detail/ProjectAIPane.tsx`

- Show a setup warning when no provider exists or the saved provider id is unavailable.
- Keep model/provider dropdown limited to configured providers.

`apps/desktop/src/renderer/src/components/project-detail/ProjectAIPane.test.tsx`

- Update fixtures to configured providers and add missing/no-provider cases.

`packages/localization/src/cli/inspectProjectsCommand.ts`

- Read connection-backed providers and report base URL/model/key status without old built-ins.

`packages/localization/src/cli/inspectProjectsCommand.test.ts`

- Cover connection-backed provider inspection and no-provider setup errors.

`packages/localization/src/LocalizationEngine.test.ts`

- Update seeded provider data to v2 connection/provider records.

`packages/localization/src/modules/MTModule.test.ts`

- Update provider fixtures and add old built-in fallback coverage.

`DOCS/30_DATA_MODEL.md`

- Document `ai_connection_catalog_v1`, `ai_provider_catalog_v2`, and connection key storage.

`DOCS/agent-first/CLI.md`

- Update provider status language.

`DOCS/agent-first/MT_MODULE.md`

- Update provider resolution language.

`DOCS/40_STATUS_AND_ROADMAP.md`

- Mark the provider pluggability direction as advanced if implementation closes the listed risk.

---

### Task 1: Core AI Model Normalization

**Files:**

- Modify: `packages/core/src/project/aiModelRegistry.ts`
- Modify: `packages/core/src/project/index.ts`
- Test: `packages/core/src/project/index.test.ts`

- [ ] **Step 1: Update the failing core tests**

Replace built-in mapping expectations with generic provider-id expectations:

```ts
import {
  DEFAULT_PROJECT_AI_MODEL,
  isProjectAIModel,
  normalizeProjectAIModel,
} from './index';

describe('project AI model ids', () => {
  it('uses an empty default when no configured provider is selected', () => {
    expect(DEFAULT_PROJECT_AI_MODEL).toBe('');
    expect(normalizeProjectAIModel(null)).toBe('');
    expect(normalizeProjectAIModel(undefined)).toBe('');
    expect(normalizeProjectAIModel('   ')).toBe('');
  });

  it('preserves configured provider ids and legacy values as plain strings', () => {
    expect(normalizeProjectAIModel('provider:demo')).toBe('provider:demo');
    expect(normalizeProjectAIModel('custom:old-provider')).toBe('custom:old-provider');
    expect(normalizeProjectAIModel('gpt-5-mini')).toBe('gpt-5-mini');
    expect(normalizeProjectAIModel('builtin:openai:gpt-5.4-mini')).toBe(
      'builtin:openai:gpt-5.4-mini',
    );
  });

  it('accepts any non-empty provider id string', () => {
    expect(isProjectAIModel('provider:demo')).toBe(true);
    expect(isProjectAIModel('custom:old-provider')).toBe(true);
    expect(isProjectAIModel('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the core project tests and verify they fail**

Run:

```bash
npx vitest run packages/core/src/project/index.test.ts
```

Expected: failures mention the old default value or old built-in model normalization.

- [ ] **Step 3: Simplify `aiModelRegistry.ts`**

Replace the file contents with this generic provider-id registry:

```ts
export type ProjectAIModel = string;

export const DEFAULT_PROJECT_AI_MODEL: ProjectAIModel = '';

export function isProjectAIModel(value: string | null | undefined): value is ProjectAIModel {
  return typeof value === 'string' && value.trim().length > 0;
}

export function normalizeProjectAIModel(value: string | null | undefined): ProjectAIModel {
  return isProjectAIModel(value) ? value.trim() : DEFAULT_PROJECT_AI_MODEL;
}
```

- [ ] **Step 4: Update `packages/core/src/project/index.ts` exports**

Remove these exports from the `aiModelRegistry` export block:

```ts
BUILTIN_OPENAI_PROVIDER_MODELS,
getBuiltinOpenAIProviderModel,
isBuiltinProjectAIModel,
isLegacyProjectAIModel,
PROJECT_AI_MODELS,
PROJECT_AI_MODEL_SET,
toBuiltinProviderId,
type BuiltinOpenAIProviderId,
```

Keep this export shape:

```ts
export {
  DEFAULT_PROJECT_AI_MODEL,
  isProjectAIModel,
  normalizeProjectAIModel,
  type ProjectAIModel,
} from './aiModelRegistry';
```

- [ ] **Step 5: Run the core project tests and verify they pass**

Run:

```bash
npx vitest run packages/core/src/project/index.test.ts
```

Expected: all tests in that file pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/project/aiModelRegistry.ts packages/core/src/project/index.ts packages/core/src/project/index.test.ts
git commit -m "refactor: make project ai provider ids generic"
```

---

### Task 2: Transport Model Discovery

**Files:**

- Modify: `packages/localization/src/ports.ts`
- Modify: `packages/localization/src/providers/AIProviderTransport.ts`
- Test: `packages/localization/src/providers/AIProviderTransport.test.ts`
- Modify: `apps/desktop/src/main/services/ports.ts`
- Modify: `apps/desktop/src/main/services/providers/AIProviderTransport.ts`
- Test: `apps/desktop/src/main/services/providers/AIProviderTransport.test.ts`

- [ ] **Step 1: Write failing localization transport tests**

Add these tests to `packages/localization/src/providers/AIProviderTransport.test.ts`:

```ts
it('lists model ids from OpenAI-compatible models responses', async () => {
  global.fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: [
          { id: 'gpt-5.4', object: 'model' },
          { id: 'text-embedding-3-large', object: 'model' },
        ],
      }),
      { status: 200 },
    ),
  ) as typeof fetch;

  const transport = new AIProviderTransport();
  const result = await transport.listModels({
    apiKey: 'secret',
    baseUrl: 'https://example.com/v1/',
  });

  expect(result).toEqual({
    endpoint: 'https://example.com/v1/models',
    models: ['gpt-5.4', 'text-embedding-3-large'],
    status: 200,
  });
  expect(global.fetch).toHaveBeenCalledWith(
    'https://example.com/v1/models',
    expect.objectContaining({
      method: 'GET',
      headers: {
        Authorization: 'Bearer secret',
      },
    }),
  );
});

it('sanitizes model list failure bodies in errors', async () => {
  global.fetch = vi.fn().mockResolvedValue(
    new Response('bad request token=secret-token ' + 'x'.repeat(1000), { status: 401 }),
  ) as typeof fetch;

  const transport = new AIProviderTransport();
  const error = await captureError(() =>
    transport.listModels({
      apiKey: 'secret',
      baseUrl: 'https://example.com/v1',
    }),
  );

  expect(error.message).toMatch(/401/);
  expect(error.message).not.toMatch(/secret-token|x{300}/);
});
```

- [ ] **Step 2: Run the localization transport tests and verify they fail**

Run:

```bash
npx vitest run packages/localization/src/providers/AIProviderTransport.test.ts
```

Expected: `transport.listModels is not a function`.

- [ ] **Step 3: Add `listModels` to the localization AI transport port**

In `packages/localization/src/ports.ts`, extend `AITransport`:

```ts
  listModels(params: {
    apiKey: string;
    baseUrl: string;
  }): Promise<{
    models: string[];
    status: number;
    endpoint: string;
    rawResponseText?: string;
  }>;
```

- [ ] **Step 4: Implement `listModels` in localization transport**

Add this public method and helper parsing code to `packages/localization/src/providers/AIProviderTransport.ts`:

```ts
function extractModelIds(data: unknown): string[] {
  if (!data || typeof data !== 'object') {
    return [];
  }

  const record = data as { data?: Array<{ id?: unknown }> };
  return (record.data ?? [])
    .map((item) => (typeof item.id === 'string' ? item.id.trim() : ''))
    .filter((id) => id.length > 0);
}

public async listModels(params: {
  apiKey: string;
  baseUrl: string;
}): Promise<{
  models: string[];
  status: number;
  endpoint: string;
  rawResponseText?: string;
}> {
  const endpoint = `${normalizeBaseUrl(params.baseUrl)}/models`;
  const errorEndpoint = redactUrlCredentials(endpoint);
  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
      },
    });
  } catch (error) {
    const message = sanitizeErrorText(error instanceof Error ? error.message : String(error));
    throw new Error(
      `AI provider model discovery failed: ${message}${this.getProxyHint()} endpoint=${errorEndpoint}`,
    );
  }

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(`AI provider model discovery failed: ${response.status} ${sanitizeErrorText(rawBody)}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(rawBody) as unknown;
  } catch {
    throw new Error(`AI provider model discovery response is not valid JSON: ${sanitizeErrorText(rawBody)}`);
  }

  return {
    models: extractModelIds(data),
    status: response.status,
    endpoint,
    rawResponseText: rawBody.slice(0, 4000),
  };
}
```

- [ ] **Step 5: Re-export desktop transport behavior**

Replace `apps/desktop/src/main/services/providers/AIProviderTransport.ts` with:

```ts
export { AIProviderTransport } from '@cat/localization';
```

- [ ] **Step 6: Add `listModels` to the desktop AI transport port**

In `apps/desktop/src/main/services/ports.ts`, extend `AITransport` with the same signature added to the localization port.

- [ ] **Step 7: Add a desktop transport import-path test**

Add this test to `apps/desktop/src/main/services/providers/AIProviderTransport.test.ts`:

```ts
it('lists model ids through the desktop transport import path', async () => {
  global.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ data: [{ id: 'gpt-demo' }] }), { status: 200 }),
  ) as typeof fetch;

  const transport = new AIProviderTransport();
  const result = await transport.listModels({
    apiKey: 'secret',
    baseUrl: 'https://example.com/v1/',
  });

  expect(result.models).toEqual(['gpt-demo']);
  expect(result.endpoint).toBe('https://example.com/v1/models');
});
```

- [ ] **Step 8: Run transport tests**

Run:

```bash
npx vitest run packages/localization/src/providers/AIProviderTransport.test.ts apps/desktop/src/main/services/providers/AIProviderTransport.test.ts
```

Expected: both transport test files pass.

- [ ] **Step 9: Commit**

```bash
git add packages/localization/src/ports.ts packages/localization/src/providers/AIProviderTransport.ts packages/localization/src/providers/AIProviderTransport.test.ts apps/desktop/src/main/services/ports.ts apps/desktop/src/main/services/providers/AIProviderTransport.ts apps/desktop/src/main/services/providers/AIProviderTransport.test.ts
git commit -m "feat: discover ai provider models"
```

---

### Task 3: Connection Catalog And Provider V2 Service

**Files:**

- Modify: `packages/localization/src/providers/AIProviderCatalogService.ts`
- Test: `packages/localization/src/providers/AIProviderCatalogService.test.ts`
- Modify: `packages/localization/src/index.ts`

- [ ] **Step 1: Replace catalog service tests with connection-backed behavior**

Use this test structure in `packages/localization/src/providers/AIProviderCatalogService.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { AIProviderCatalogService } from './AIProviderCatalogService';
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
```

Add these behavior tests:

```ts
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
  expect(result.connection).toMatchObject({
    name: 'OpenAI',
    baseUrl: 'https://example.com/v1',
    discoveredModels: ['gpt-demo', 'gpt-demo-mini'],
    apiKeyLast4: '1234',
  });
  expect(settingsRepo.dump()[`ai_connection_key::${result.connection?.id}`]).toBe('secret-key-1234');
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
  });
  expect(transport.testConnection).toHaveBeenCalledWith({
    apiKey: 'secret-key-1234',
    baseUrl: 'https://example.com/v1',
    model: 'gpt-demo',
  });
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

it('falls old builtin ids back to the first configured provider', async () => {
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

  expect(service.resolveProviderConfig('builtin:openai:gpt-5.4-mini').provider.id).toBe(provider.id);
});

it('throws a setup error when no configured provider exists', () => {
  const service = new AIProviderCatalogService(createSettingsRepo(), createTransport());

  expect(() => service.resolveProviderConfig('builtin:openai:gpt-5.4-mini')).toThrow(
    /AI provider is not configured/i,
  );
});
```

- [ ] **Step 2: Run the catalog tests and verify they fail**

Run:

```bash
npx vitest run packages/localization/src/providers/AIProviderCatalogService.test.ts
```

Expected: failures mention missing `testConnection`, changed `addProvider` input, and old built-in provider behavior.

- [ ] **Step 3: Implement new catalog types and constants**

At the top of `packages/localization/src/providers/AIProviderCatalogService.ts`, replace old provider-only constants and interfaces with:

```ts
const CONNECTION_CATALOG_KEY = 'ai_connection_catalog_v1';
const PROVIDER_CATALOG_KEY = 'ai_provider_catalog_v2';
const LEGACY_PROVIDER_CATALOG_KEY = 'ai_provider_catalog_v1';
const CONNECTION_KEY_PREFIX = 'ai_connection_key::';
const LEGACY_PROVIDER_KEY_PREFIX = 'ai_provider_key::';
const OPENAI_API_KEY = 'openai_api_key';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const PROVIDER_TIMESTAMP = '1970-01-01T00:00:00.000Z';

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
```

- [ ] **Step 4: Add model filtering helper**

Add this pure helper in the catalog service file:

```ts
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
```

- [ ] **Step 5: Implement connection and provider read/write helpers**

Add private helpers with these names and behavior:

```ts
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
        ...connection,
        baseUrl: normalizeBaseUrl(connection.baseUrl),
        discoveredModels: filterDiscoveredModelIds(
          connection.discoveredModels.filter((model): model is string => typeof model === 'string'),
        ),
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

    return parsed.filter((value): value is StoredAIProvider => {
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
    });
  } catch {
    return [];
  }
}

private writeStoredProviders(providers: StoredAIProvider[]): void {
  this.settingsRepo.setSetting(PROVIDER_CATALOG_KEY, JSON.stringify(providers));
}

private buildConnectionKey(connectionId: string): string {
  return `${CONNECTION_KEY_PREFIX}${connectionId}`;
}
```

- [ ] **Step 6: Implement `listConnections` and `testConnection`**

Add public methods:

```ts
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
    const existing = normalized.connectionId
      ? this.readStoredConnections().find((connection) => connection.id === normalized.connectionId)
      : undefined;
    const connection: StoredAIConnection = {
      id: existing?.id ?? `connection:${randomUUID()}`,
      name: normalized.name,
      baseUrl: normalized.baseUrl,
      protocol: 'chat-completions',
      kind: 'openai-compatible',
      apiKeyLast4: normalized.apiKey.slice(-4),
      discoveredModels,
      lastTestedAt: now,
      lastRefreshedAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const nextConnections = [
      ...this.readStoredConnections().filter((candidate) => candidate.id !== connection.id),
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
```

- [ ] **Step 7: Implement provider creation and deletion**

`addProvider` becomes async because it probes the selected model:

```ts
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
    throw new Error(`Model "${normalized.model}" was not discovered for connection "${connection.name}".`);
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
```

Add `deleteConnection(connectionId, isInUse)`:

```ts
public deleteConnection(connectionId: string, isInUse: boolean): void {
  if (isInUse || this.readStoredProviders().some((provider) => provider.connectionId === connectionId)) {
    throw new Error('Cannot delete an AI connection that has providers.');
  }
  const nextConnections = this.readStoredConnections().filter(
    (connection) => connection.id !== connectionId,
  );
  if (nextConnections.length === this.readStoredConnections().length) {
    throw new Error('AI connection not found');
  }
  this.writeStoredConnections(nextConnections);
  this.settingsRepo.setSetting(this.buildConnectionKey(connectionId), null);
}
```

- [ ] **Step 8: Implement runtime resolution and compatibility reads**

`listProviders()` should return:

```ts
return [
  ...this.readConfiguredProviderSummaries(),
  ...this.readLegacyProviderSummaries(),
];
```

`resolveProviderConfig(providerId)` should:

```ts
const configuredProviders = this.readConfiguredProviderSummaries();
const normalizedProviderId = normalizeProjectAIModel(providerId);
const provider =
  configuredProviders.find((candidate) => candidate.id === normalizedProviderId) ??
  (isLegacyOrMissingProviderId(normalizedProviderId) ? configuredProviders[0] : undefined);

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

return { provider, apiKey };
```

`readLegacyProviderSummaries()` should read `ai_provider_catalog_v1` and `openai_api_key` without writing v2 settings. Old custom providers appear with `kind: 'legacy'`, synthetic `connectionId`, and their old `baseUrl/model`. Old four built-ins must not be generated.

- [ ] **Step 9: Update localization exports**

In `packages/localization/src/index.ts`, export the new types:

```ts
export {
  AIProviderCatalogService,
  filterDiscoveredModelIds,
  type AddAIProviderInput,
  type AIConnectionSummary,
  type AIProviderSummary,
  type AITestConnectionResult,
  type ResolvedAIProviderConfig,
  type TestAIConnectionInput,
} from './providers/AIProviderCatalogService';
```

- [ ] **Step 10: Run catalog tests**

Run:

```bash
npx vitest run packages/localization/src/providers/AIProviderCatalogService.test.ts
```

Expected: all tests in that file pass.

- [ ] **Step 11: Commit**

```bash
git add packages/localization/src/providers/AIProviderCatalogService.ts packages/localization/src/providers/AIProviderCatalogService.test.ts packages/localization/src/index.ts
git commit -m "feat: add connection backed ai provider catalog"
```

---

### Task 4: Desktop Main Service Reuse

**Files:**

- Modify: `apps/desktop/src/main/services/modules/ai/AIProviderCatalogService.ts`
- Test: `apps/desktop/src/main/services/modules/ai/AIProviderCatalogService.test.ts`
- Modify: `apps/desktop/src/main/services/modules/AIModule.ts`
- Modify: `apps/desktop/src/main/services/ProjectService.ts`

- [ ] **Step 1: Update desktop catalog tests for shared behavior**

Replace the old "lists builtin OpenAI providers by default" test with:

```ts
it('does not synthesize fixed builtin OpenAI model providers', () => {
  const service = new AIProviderCatalogService(createSettingsRepo(), createTransport());

  expect(service.listProviders()).toEqual([]);
});
```

Add a desktop import-path smoke test:

```ts
it('creates providers through the shared connection-backed implementation', async () => {
  const service = new AIProviderCatalogService(createSettingsRepo(), createTransport());
  const tested = await service.testConnection({
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'secret-1234',
  });

  const provider = await service.addProvider({
    name: 'OpenAI / gpt-demo',
    connectionId: tested.connection!.id,
    model: 'gpt-demo',
  });

  expect(provider).toMatchObject({
    name: 'OpenAI / gpt-demo',
    kind: 'configured',
    model: 'gpt-demo',
  });
});
```

- [ ] **Step 2: Run the desktop catalog tests and verify they fail**

Run:

```bash
npx vitest run apps/desktop/src/main/services/modules/ai/AIProviderCatalogService.test.ts
```

Expected: failures from old built-in behavior or missing connection methods.

- [ ] **Step 3: Re-export shared catalog service from desktop path**

Replace `apps/desktop/src/main/services/modules/ai/AIProviderCatalogService.ts` with:

```ts
export {
  AIProviderCatalogService,
  filterDiscoveredModelIds,
  type AddAIProviderInput,
  type AIConnectionSummary,
  type AIProviderSummary,
  type AITestConnectionResult,
  type ResolvedAIProviderConfig,
  type TestAIConnectionInput,
} from '@cat/localization';
```

- [ ] **Step 4: Update `AIModule` methods**

In `apps/desktop/src/main/services/modules/AIModule.ts`, add:

```ts
  public listAIConnections(): AIConnectionSummary[] {
    return this.providerCatalogService.listConnections();
  }

  public async testAIConnection(input: TestAIConnectionInput): Promise<AITestConnectionResult> {
    return this.providerCatalogService.testConnection(input);
  }

  public deleteAIConnection(connectionId: string): void {
    const hasProvider = this.providerCatalogService
      .listProviders()
      .some((provider) => provider.connectionId === connectionId);
    this.providerCatalogService.deleteConnection(connectionId, hasProvider);
  }
```

Change provider creation to async:

```ts
  public async addAIProvider(input: AddAIProviderInput): Promise<AIProviderSummary> {
    return this.providerCatalogService.addProvider(input);
  }
```

Keep legacy `getAISettings`, `setAIKey`, and `clearAIKey` in place for compatibility, but the renderer should stop using them after Task 6.

- [ ] **Step 5: Update `ProjectService` methods**

In `apps/desktop/src/main/services/ProjectService.ts`, add:

```ts
  public listAIConnections() {
    return this.aiModule.listAIConnections();
  }

  public async testAIConnection(input: TestAIConnectionInput) {
    return this.aiModule.testAIConnection(input);
  }

  public deleteAIConnection(connectionId: string) {
    return this.aiModule.deleteAIConnection(connectionId);
  }
```

Change `addAIProvider` to:

```ts
  public async addAIProvider(input: AddAIProviderInput): Promise<AIProviderSummary> {
    return this.aiModule.addAIProvider(input);
  }
```

- [ ] **Step 6: Run desktop catalog tests**

Run:

```bash
npx vitest run apps/desktop/src/main/services/modules/ai/AIProviderCatalogService.test.ts
```

Expected: all tests in that file pass.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/services/modules/ai/AIProviderCatalogService.ts apps/desktop/src/main/services/modules/ai/AIProviderCatalogService.test.ts apps/desktop/src/main/services/modules/AIModule.ts apps/desktop/src/main/services/ProjectService.ts
git commit -m "refactor: reuse shared ai provider catalog in desktop"
```

---

### Task 5: IPC And Preload Contract

**Files:**

- Modify: `apps/desktop/src/shared/ipc.ts`
- Modify: `apps/desktop/src/shared/ipcChannels.ts`
- Modify: `apps/desktop/src/preload/api/aiApi.ts`
- Test: `apps/desktop/src/preload/api/createDesktopApi.test.ts`
- Modify: `apps/desktop/src/main/ipc/aiHandlers.ts`

- [ ] **Step 1: Update shared IPC types**

In `apps/desktop/src/shared/ipc.ts`, replace the provider input/result block with:

```ts
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
```

Update `DesktopApi`:

```ts
  listAIConnections: () => Promise<AIConnectionSummary[]>;
  testAIConnection: (input: TestAIConnectionInput) => Promise<AITestConnectionResult>;
  deleteAIConnection: (connectionId: string) => Promise<void>;
  listAIProviders: () => Promise<AIProviderSummary[]>;
  addAIProvider: (input: AddAIProviderInput) => Promise<AIProviderSummary>;
```

- [ ] **Step 2: Update IPC channel constants**

Add channel names in `apps/desktop/src/shared/ipcChannels.ts`:

```ts
listConnections: 'ai:list-connections',
testConnection: 'ai:test-connection',
deleteConnection: 'ai:delete-connection',
```

Keep existing `listProviders`, `addProvider`, and `deleteProvider`.

- [ ] **Step 3: Update preload test expectations**

In `apps/desktop/src/preload/api/createDesktopApi.test.ts`, add:

```ts
await api.listAIConnections();
expect(ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.listConnections);

await api.testAIConnection({
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'secret',
});
expect(ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.testConnection, {
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'secret',
});

await api.deleteAIConnection('connection:demo');
expect(ipcRenderer.invoke).toHaveBeenCalledWith(
  IPC_CHANNELS.ai.deleteConnection,
  'connection:demo',
);
```

Update provider creation expectations to:

```ts
await api.addAIProvider({
  name: 'OpenAI / gpt-demo',
  connectionId: 'connection:demo',
  model: 'gpt-demo',
});
expect(ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.ai.addProvider, {
  name: 'OpenAI / gpt-demo',
  connectionId: 'connection:demo',
  model: 'gpt-demo',
});
```

- [ ] **Step 4: Run preload tests and verify they fail**

Run:

```bash
npx vitest run apps/desktop/src/preload/api/createDesktopApi.test.ts
```

Expected: failures mention missing connection API methods or old provider input.

- [ ] **Step 5: Update `aiApi.ts`**

Add keys:

```ts
  | 'listAIConnections'
  | 'deleteAIConnection'
```

Update the API object:

```ts
    listAIConnections: () =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.listConnections) as ReturnType<
        DesktopApi['listAIConnections']
      >,
    testAIConnection: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.testConnection, input) as ReturnType<
        DesktopApi['testAIConnection']
      >,
    deleteAIConnection: (connectionId) =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.deleteConnection, connectionId) as ReturnType<
        DesktopApi['deleteAIConnection']
      >,
```

- [ ] **Step 6: Update AI IPC handlers**

In `apps/desktop/src/main/ipc/aiHandlers.ts`, add:

```ts
  registerHandle({ ipcMain, projectService, jobManager }, IPC_CHANNELS.ai.listConnections, () =>
    projectService.listAIConnections(),
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.ai.testConnection,
    (_event, ...args) => {
      const [input] = args as [Parameters<typeof projectService.testAIConnection>[0]];
      return projectService.testAIConnection(input);
    },
  );

  registerHandle(
    { ipcMain, projectService, jobManager },
    IPC_CHANNELS.ai.deleteConnection,
    (_event, ...args) => {
      const [connectionId] = args as [string];
      return projectService.deleteAIConnection(connectionId);
    },
  );
```

Keep `getSettings`, `setKey`, and `clearKey` handlers until after UI migration has settled.

- [ ] **Step 7: Run preload tests**

Run:

```bash
npx vitest run apps/desktop/src/preload/api/createDesktopApi.test.ts
```

Expected: preload API tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/shared/ipc.ts apps/desktop/src/shared/ipcChannels.ts apps/desktop/src/preload/api/aiApi.ts apps/desktop/src/preload/api/createDesktopApi.test.ts apps/desktop/src/main/ipc/aiHandlers.ts
git commit -m "feat: expose ai connection ipc"
```

---

### Task 6: Settings Modal Connection Workflow

**Files:**

- Modify: `apps/desktop/src/renderer/src/components/SettingsModal.tsx`
- Test: `apps/desktop/src/renderer/src/components/SettingsModal.test.tsx`

- [ ] **Step 1: Update SettingsModal test fixture types**

In the mock, replace old AI key and provider methods with:

```ts
const apiClientMock = {
  listAIConnections: vi.fn(),
  testAIConnection: vi.fn(),
  deleteAIConnection: vi.fn(),
  listAIProviders: vi.fn(),
  addAIProvider: vi.fn(),
  deleteAIProvider: vi.fn(),
  getProxySettings: vi.fn(),
  setProxySettings: vi.fn(),
};
```

Seed a connection and provider like this:

```ts
const connection = {
  id: 'connection:openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  protocol: 'chat-completions',
  kind: 'openai-compatible',
  apiKeyLast4: '1234',
  discoveredModels: ['gpt-demo', 'gpt-demo-mini'],
  lastTestedAt: '2026-05-22T00:00:00.000Z',
  lastRefreshedAt: '2026-05-22T00:00:00.000Z',
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
};

const provider = {
  id: 'provider:gpt-demo',
  name: 'OpenAI / gpt-demo',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-demo',
  protocol: 'chat-completions',
  kind: 'configured',
  connectionId: 'connection:openai',
  connectionName: 'OpenAI',
  apiKeyLast4: '1234',
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
};
```

- [ ] **Step 2: Write failing Settings workflow tests**

Add:

```ts
it('tests a connection, shows discovered models, and creates a provider', async () => {
  apiClientMock.listAIConnections.mockResolvedValue([]);
  apiClientMock.listAIProviders.mockResolvedValue([]);
  apiClientMock.testAIConnection.mockResolvedValue({
    ok: true,
    connection,
    models: ['gpt-demo', 'gpt-demo-mini'],
    endpoint: 'https://api.openai.com/v1/models',
  });
  apiClientMock.addAIProvider.mockResolvedValue(provider);

  render(<SettingsModal isOpen onClose={vi.fn()} />);

  await screen.findByText('AI Connections');
  fireEvent.change(screen.getByLabelText('Connection Name'), {
    target: { value: 'OpenAI' },
  });
  fireEvent.change(screen.getByLabelText('API Base URL'), {
    target: { value: 'https://api.openai.com/v1' },
  });
  fireEvent.change(screen.getByLabelText('API Key'), {
    target: { value: 'secret-1234' },
  });

  fireEvent.click(screen.getByText('Test Connection'));

  await waitFor(() =>
    expect(apiClientMock.testAIConnection).toHaveBeenCalledWith({
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'secret-1234',
    }),
  );
  await screen.findByRole('option', { name: 'gpt-demo' });

  fireEvent.change(screen.getByLabelText('Provider Name'), {
    target: { value: 'OpenAI / gpt-demo' },
  });
  fireEvent.change(screen.getByLabelText('Model'), {
    target: { value: 'gpt-demo-mini' },
  });
  fireEvent.click(screen.getByText('Add Provider'));

  await waitFor(() =>
    expect(apiClientMock.addAIProvider).toHaveBeenCalledWith({
      name: 'OpenAI / gpt-demo',
      connectionId: 'connection:openai',
      model: 'gpt-demo-mini',
    }),
  );
});

it('lists configured providers without builtin lock controls', async () => {
  apiClientMock.listAIConnections.mockResolvedValue([connection]);
  apiClientMock.listAIProviders.mockResolvedValue([provider]);

  render(<SettingsModal isOpen onClose={vi.fn()} />);

  await screen.findByText('OpenAI / gpt-demo');
  expect(screen.queryByText('Built-in')).not.toBeInTheDocument();
  expect(screen.getByText('Delete Provider')).toBeEnabled();
});
```

- [ ] **Step 3: Run SettingsModal tests and verify they fail**

Run:

```bash
npx vitest run apps/desktop/src/renderer/src/components/SettingsModal.test.tsx
```

Expected: failures mention missing labels or old provider form calls.

- [ ] **Step 4: Refactor SettingsModal state**

Use these state fields:

```ts
const [connections, setConnections] = useState<AIConnectionSummary[]>([]);
const [providers, setProviders] = useState<AIProviderSummary[]>([]);
const [connectionNameInput, setConnectionNameInput] = useState('');
const [connectionBaseUrlInput, setConnectionBaseUrlInput] = useState('');
const [connectionApiKeyInput, setConnectionApiKeyInput] = useState('');
const [testedConnection, setTestedConnection] = useState<AIConnectionSummary | null>(null);
const [selectedModel, setSelectedModel] = useState('');
const [providerNameInput, setProviderNameInput] = useState('');
```

On open, load:

```ts
const [proxySettings, connectionList, providerList] = await Promise.all([
  apiClient.getProxySettings(),
  apiClient.listAIConnections(),
  apiClient.listAIProviders(),
]);
```

- [ ] **Step 5: Replace tabs**

Use:

```ts
type SettingsTabId = 'connections' | 'proxy';

const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string }> = [
  { id: 'connections', label: 'AI Connections' },
  { id: 'proxy', label: 'Proxy' },
];
```

- [ ] **Step 6: Implement connection testing handler**

```ts
const handleTestConnection = async () => {
  setTestingProvider(true);
  setStatus(null);
  try {
    await applyProxySettings();
    const result = await apiClient.testAIConnection({
      name: connectionNameInput,
      baseUrl: connectionBaseUrlInput,
      apiKey: connectionApiKeyInput,
    });

    if (!result.ok || !result.connection) {
      setTestedConnection(null);
      setSelectedModel('');
      setStatus(`Connection test failed: ${result.error || 'Unknown error'}`);
      return;
    }

    setTestedConnection(result.connection);
    setSelectedModel(result.connection.discoveredModels[0] ?? '');
    setProviderNameInput(`${result.connection.name} / ${result.connection.discoveredModels[0] ?? ''}`);
    await reloadConnectionsAndProviders();
    setStatus(`Connection tested: ${result.connection.discoveredModels.length} models discovered.`);
  } catch (error) {
    setTestedConnection(null);
    setSelectedModel('');
    setStatus(`Connection test failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    setTestingProvider(false);
  }
};
```

- [ ] **Step 7: Implement provider creation handler**

```ts
const handleAddProvider = async () => {
  if (!testedConnection || !selectedModel) {
    setStatus('Test a connection and choose a model before adding a provider.');
    return;
  }

  setAddingProvider(true);
  setStatus(null);
  try {
    await apiClient.addAIProvider({
      name: providerNameInput.trim() || `${testedConnection.name} / ${selectedModel}`,
      connectionId: testedConnection.id,
      model: selectedModel,
    });
    await reloadConnectionsAndProviders();
    notifyAIProvidersChanged();
    setStatus('AI provider added.');
  } catch (error) {
    setStatus(`Failed to add provider: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    setAddingProvider(false);
  }
};
```

- [ ] **Step 8: Render connection and provider management**

The connection section must include labels:

```tsx
<h3 className="text-sm font-bold text-text">AI Connections</h3>
<label className="field-label">Connection Name</label>
<label className="field-label">API Base URL</label>
<label className="field-label">API Key</label>
<button onClick={handleTestConnection}>Test Connection</button>
<label className="field-label">Model</label>
<select aria-label="Model" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
  {(testedConnection?.discoveredModels ?? []).map((model) => (
    <option key={model} value={model}>{model}</option>
  ))}
</select>
<label className="field-label">Provider Name</label>
<button onClick={handleAddProvider}>Add Provider</button>
```

Provider rows should use `Delete Provider` for provider deletion. Connection rows should show key last4 and model count. Delete connection buttons call `apiClient.deleteAIConnection(connection.id)`.

- [ ] **Step 9: Run SettingsModal tests**

Run:

```bash
npx vitest run apps/desktop/src/renderer/src/components/SettingsModal.test.tsx
```

Expected: Settings modal tests pass.

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src/renderer/src/components/SettingsModal.tsx apps/desktop/src/renderer/src/components/SettingsModal.test.tsx
git commit -m "feat: manage ai connections in settings"
```

---

### Task 7: Project AI Pane Provider Availability

**Files:**

- Modify: `apps/desktop/src/renderer/src/hooks/projectDetail/ai/aiSettingsHelpers.ts`
- Test: `apps/desktop/src/renderer/src/hooks/projectDetail/useProjectAI.test.ts`
- Modify: `apps/desktop/src/renderer/src/hooks/projectDetail/ai/types.ts`
- Modify: `apps/desktop/src/renderer/src/hooks/projectDetail/useProjectAI.ts`
- Modify: `apps/desktop/src/renderer/src/components/project-detail/ProjectAIPane.tsx`
- Test: `apps/desktop/src/renderer/src/components/project-detail/ProjectAIPane.test.tsx`

- [ ] **Step 1: Update helper tests**

In `useProjectAI.test.ts`, change normalization tests to:

```ts
it('preserves unavailable project provider ids instead of selecting a builtin default', () => {
  expect(normalizeProjectAIProviderSelection('provider:missing', [])).toBe('provider:missing');
  expect(normalizeProjectAIProviderSelection(null, [])).toBe('');
});
```

- [ ] **Step 2: Update helper implementation**

Change `normalizeProjectAIProviderSelection`:

```ts
export function normalizeProjectAIProviderSelection(
  value: string | null | undefined,
  providers: AIProviderSummary[],
): string {
  const normalized = normalizeProjectAIModelCore(value);
  if (!normalized) {
    return providers[0]?.id ?? '';
  }
  return normalized;
}
```

- [ ] **Step 3: Add controller fields**

In `types.ts`, add:

```ts
providerUnavailable: boolean;
providerSetupRequired: boolean;
providerWarning: string | null;
```

- [ ] **Step 4: Compute provider availability in `useProjectAI`**

After provider options and model draft are resolved:

```ts
const providerSetupRequired = providerOptions.length === 0;
const providerUnavailable =
  !providerSetupRequired &&
  Boolean(modelDraft) &&
  !providerOptions.some((provider) => provider.id === modelDraft);
const providerWarning = providerSetupRequired
  ? 'Add an AI provider in Settings before running AI actions.'
  : providerUnavailable
    ? 'The saved AI provider is no longer available. Choose a configured provider and save.'
    : null;
```

Return those fields in the controller object.

- [ ] **Step 5: Update ProjectAIPane tests**

Change fixtures from built-in/custom to configured providers:

```ts
providerOptions: [
  {
    id: 'provider:gpt-demo',
    name: 'OpenAI / gpt-demo',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-demo',
    protocol: 'chat-completions',
    kind: 'configured',
    connectionId: 'connection:openai',
    connectionName: 'OpenAI',
    apiKeyLast4: '1234',
    createdAt: '2026-05-22T00:00:00.000Z',
    updatedAt: '2026-05-22T00:00:00.000Z',
  },
],
modelDraft: 'provider:gpt-demo',
providerUnavailable: false,
providerSetupRequired: false,
providerWarning: null,
```

Add no-provider test:

```ts
it('shows setup guidance when no providers are configured', () => {
  const controller = createController({
    providerOptions: [],
    modelDraft: '',
    providerSetupRequired: true,
    providerWarning: 'Add an AI provider in Settings before running AI actions.',
  });

  render(<ProjectAIPane ai={controller} />);

  expect(screen.getByText('Add an AI provider in Settings before running AI actions.')).toBeInTheDocument();
  expect(screen.getByLabelText('AI Provider')).toBeDisabled();
});
```

- [ ] **Step 6: Update ProjectAIPane rendering**

In the provider select block:

```tsx
{ai.providerWarning && (
  <Notice tone="warning" className="mb-2 text-xs">
    {ai.providerWarning}
  </Notice>
)}
<Select
  aria-label="AI Provider"
  value={ai.modelDraft}
  onChange={(event) => ai.setModelDraft(event.target.value as typeof ai.modelDraft)}
  className="w-72"
  disabled={ai.providerSetupRequired}
>
  {ai.providerOptions.map((provider) => (
    <option key={provider.id} value={provider.id}>
      {provider.name}
    </option>
  ))}
</Select>
```

- [ ] **Step 7: Run project AI tests**

Run:

```bash
npx vitest run apps/desktop/src/renderer/src/hooks/projectDetail/useProjectAI.test.ts apps/desktop/src/renderer/src/components/project-detail/ProjectAIPane.test.tsx
```

Expected: both test files pass.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/src/hooks/projectDetail/ai/aiSettingsHelpers.ts apps/desktop/src/renderer/src/hooks/projectDetail/useProjectAI.test.ts apps/desktop/src/renderer/src/hooks/projectDetail/ai/types.ts apps/desktop/src/renderer/src/hooks/projectDetail/useProjectAI.ts apps/desktop/src/renderer/src/components/project-detail/ProjectAIPane.tsx apps/desktop/src/renderer/src/components/project-detail/ProjectAIPane.test.tsx
git commit -m "feat: show configured ai providers in projects"
```

---

### Task 8: CLI And Headless Provider Resolution

**Files:**

- Modify: `packages/localization/src/cli/inspectProjectsCommand.ts`
- Test: `packages/localization/src/cli/inspectProjectsCommand.test.ts`
- Test: `packages/localization/src/LocalizationEngine.test.ts`
- Test: `packages/localization/src/modules/MTModule.test.ts`

- [ ] **Step 1: Update inspect projects tests**

Seed connection/provider v2 settings:

```ts
db.setSetting(
  'ai_connection_catalog_v1',
  JSON.stringify([
    {
      id: 'connection:openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      protocol: 'chat-completions',
      kind: 'openai-compatible',
      apiKeyLast4: '1234',
      discoveredModels: ['gpt-demo'],
      createdAt: '2026-05-22T00:00:00.000Z',
      updatedAt: '2026-05-22T00:00:00.000Z',
    },
  ]),
);
db.setSetting('ai_connection_key::connection:openai', 'sk-test-1234');
db.setSetting(
  'ai_provider_catalog_v2',
  JSON.stringify([
    {
      id: 'provider:gpt-demo',
      name: 'OpenAI / gpt-demo',
      connectionId: 'connection:openai',
      model: 'gpt-demo',
      protocol: 'chat-completions',
      kind: 'configured',
      createdAt: '2026-05-22T00:00:00.000Z',
      updatedAt: '2026-05-22T00:00:00.000Z',
    },
  ]),
);
db.updateProjectAISettings(projectId, 'Use concise style.', 'provider:gpt-demo');
```

Assert:

```ts
expect(result.providers).toEqual([
  expect.objectContaining({
    id: 'provider:gpt-demo',
    name: 'OpenAI / gpt-demo',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-demo',
    kind: 'configured',
    apiKeySet: true,
    apiKeyLast4: '1234',
  }),
]);
expect(result.projects[0].model).toMatchObject({
  id: 'provider:gpt-demo',
  model: 'gpt-demo',
});
```

- [ ] **Step 2: Run inspect tests and verify they fail**

Run:

```bash
npx vitest run packages/localization/src/cli/inspectProjectsCommand.test.ts
```

Expected: failures mention old provider catalog parsing or built-in model resolution.

- [ ] **Step 3: Update inspectProjectsCommand provider parsing**

Replace old constants:

```ts
const CONNECTION_CATALOG_KEY = 'ai_connection_catalog_v1';
const PROVIDER_CATALOG_KEY = 'ai_provider_catalog_v2';
const CONNECTION_KEY_PREFIX = 'ai_connection_key::';
```

Read settings for both catalogs and connection keys. Provider summary resolution should join provider records to connection records:

```ts
function readConfiguredProviders(settings: Map<string, string>): InspectProviderSummary[] {
  const connections = readConnections(settings);
  const providers = readProviders(settings);
  return providers.flatMap((provider) => {
    const connection = connections.get(provider.connectionId);
    if (!connection) {
      return [];
    }
    const apiKey = settings.get(`${CONNECTION_KEY_PREFIX}${connection.id}`) ?? '';
    return [{
      id: provider.id,
      name: provider.name,
      baseUrl: connection.baseUrl,
      model: provider.model,
      kind: 'configured' as const,
      apiKeySet: Boolean(apiKey),
      apiKeyLast4: apiKey ? apiKey.slice(-4) : null,
    }];
  });
}
```

Remove imports of `BUILTIN_OPENAI_PROVIDER_MODELS` and `DEFAULT_PROJECT_AI_MODEL`.

- [ ] **Step 4: Update project model resolution**

Use configured providers first:

```ts
const configuredId =
  typeof rawModel === 'string' && rawModel.trim() ? rawModel.trim() : null;
const provider = configuredId ? providerById.get(configuredId) : undefined;
if (provider) {
  return { ...provider, configuredId, fallbackFrom: null };
}
const fallback = providers[0];
if (fallback) {
  return {
    ...fallback,
    configuredId,
    fallbackFrom: configuredId,
    resolvedId: fallback.id,
  };
}
return {
  id: configuredId ?? '',
  configuredId,
  name: 'No configured AI provider',
  baseUrl: null,
  model: null,
  kind: 'configured',
  apiKeySet: false,
  apiKeyLast4: null,
  fallbackFrom: configuredId,
};
```

- [ ] **Step 5: Update LocalizationEngine and MTModule tests**

Replace `openai_api_key`-only setup with v2 settings in test helpers:

```ts
db.setSetting(
  'ai_connection_catalog_v1',
  JSON.stringify([
    {
      id: 'connection:test',
      name: 'Test Connection',
      baseUrl: 'https://example.com/v1',
      protocol: 'chat-completions',
      kind: 'openai-compatible',
      apiKeyLast4: 'key',
      discoveredModels: ['gpt-demo'],
      createdAt: '2026-05-22T00:00:00.000Z',
      updatedAt: '2026-05-22T00:00:00.000Z',
    },
  ]),
);
db.setSetting('ai_connection_key::connection:test', 'test-api-key');
db.setSetting(
  'ai_provider_catalog_v2',
  JSON.stringify([
    {
      id: 'provider:gpt-demo',
      name: 'Test / gpt-demo',
      connectionId: 'connection:test',
      model: 'gpt-demo',
      protocol: 'chat-completions',
      kind: 'configured',
      createdAt: '2026-05-22T00:00:00.000Z',
      updatedAt: '2026-05-22T00:00:00.000Z',
    },
  ]),
);
db.updateProjectAISettings(projectId, null, 'provider:gpt-demo');
```

- [ ] **Step 6: Run headless tests**

Run:

```bash
npx vitest run packages/localization/src/cli/inspectProjectsCommand.test.ts packages/localization/src/LocalizationEngine.test.ts packages/localization/src/modules/MTModule.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/localization/src/cli/inspectProjectsCommand.ts packages/localization/src/cli/inspectProjectsCommand.test.ts packages/localization/src/LocalizationEngine.test.ts packages/localization/src/modules/MTModule.test.ts
git commit -m "fix: resolve headless ai providers from connections"
```

---

### Task 9: Documentation And Final Verification

**Files:**

- Modify: `DOCS/30_DATA_MODEL.md`
- Modify: `DOCS/agent-first/CLI.md`
- Modify: `DOCS/agent-first/MT_MODULE.md`
- Modify: `DOCS/40_STATUS_AND_ROADMAP.md`
- Run: package and app validation commands

- [ ] **Step 1: Update data model docs**

In `DOCS/30_DATA_MODEL.md`, replace the AI runtime config paragraph with:

```md
AI provider config:
- Project provider selection is stored in `projects.aiModel`; the value is a configured provider id.
- AI connections are stored in `app_settings.ai_connection_catalog_v1`.
- Connection API keys are stored separately with key prefix `ai_connection_key::`.
- Project-selectable providers are stored in `app_settings.ai_provider_catalog_v2`.
- Legacy `ai_provider_catalog_v1` and `openai_api_key` are read only for compatibility.
```

- [ ] **Step 2: Update agent-first CLI docs**

In `DOCS/agent-first/CLI.md`, change provider status wording to say:

```md
- Reads configured AI providers from connection-backed provider settings.
- Reports provider id, connection base URL, selected model, and API key status.
- Does not list hard-coded built-in OpenAI models.
```

- [ ] **Step 3: Update MT module docs**

In `DOCS/agent-first/MT_MODULE.md`, change provider resolution wording to:

```md
MT resolves `projects.aiModel` as a configured provider id, then resolves that
provider through its connection to obtain `baseUrl`, API key, model, and
chat-completions protocol.
```

- [ ] **Step 4: Update roadmap if applicable**

In `DOCS/40_STATUS_AND_ROADMAP.md`, update the provider pluggability item to mention:

```md
Connection-backed OpenAI-compatible providers replace the old fixed built-in
OpenAI model list. Remaining provider work should focus on protocol expansion,
not on maintaining a model allowlist.
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npx vitest run packages/core/src/project/index.test.ts packages/localization/src/providers/AIProviderTransport.test.ts packages/localization/src/providers/AIProviderCatalogService.test.ts apps/desktop/src/main/services/modules/ai/AIProviderCatalogService.test.ts apps/desktop/src/preload/api/createDesktopApi.test.ts apps/desktop/src/renderer/src/components/SettingsModal.test.tsx apps/desktop/src/renderer/src/components/project-detail/ProjectAIPane.test.tsx packages/localization/src/cli/inspectProjectsCommand.test.ts packages/localization/src/LocalizationEngine.test.ts packages/localization/src/modules/MTModule.test.ts
```

Expected: all listed test files pass.

- [ ] **Step 6: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: TypeScript exits with status 0.

- [ ] **Step 7: Run build**

Run:

```bash
npm run build
```

Expected: build exits with status 0.

- [ ] **Step 8: Commit docs and any final fixes**

```bash
git add DOCS/30_DATA_MODEL.md DOCS/agent-first/CLI.md DOCS/agent-first/MT_MODULE.md DOCS/40_STATUS_AND_ROADMAP.md
git commit -m "docs: document connection backed ai providers"
```

If final fixes were required after typecheck or build, include only the touched fix files in a separate focused commit before the docs commit.

---

## Self-Review Checklist

- Spec coverage:
  - Reusable `baseUrl + apiKey` connections: Task 3, Task 6.
  - Discovered model list instead of hard-coded four OpenAI models: Task 1, Task 2, Task 3.
  - Multiple providers from one connection: Task 3, Task 6.
  - Project page only selects configured providers: Task 7.
  - OpenAI-compatible `/models` and `/chat/completions`: Task 2, Task 3.
  - Runtime errors for missing provider, connection, or key: Task 3, Task 8.
  - Old custom compatibility and old built-in fallback: Task 3, Task 8.
  - Deletion protections: Task 3, Task 6.
  - Docs updates: Task 9.
- Type consistency:
  - `AIConnectionSummary`, `AIProviderSummary`, `TestAIConnectionInput`, `AITestConnectionResult`, and `AddAIProviderInput` are introduced in shared IPC and localization exports.
  - `AITransport.listModels` is added to both localization and desktop ports.
  - `AIModule.addAIProvider` and `ProjectService.addAIProvider` become async.
- Validation:
  - Focused Vitest commands run after each task.
  - Final `npm run typecheck` and `npm run build` close the implementation.
