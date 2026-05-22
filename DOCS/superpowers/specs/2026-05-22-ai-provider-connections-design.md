# AI Provider Connections Design

## Purpose

Simplify AI provider configuration by separating reusable OpenAI-compatible
connections from project-selectable model providers.

The current implementation treats each built-in OpenAI model as a separate
provider, such as `builtin:openai:gpt-5.4-mini`. That couples provider identity
to a small hard-coded model list and forces code changes whenever available
models change. The new design makes `baseUrl + apiKey` the reusable connection
layer and makes selected models explicit provider records created from discovered
models.

## Goals

- Let users configure an OpenAI-compatible `baseUrl + apiKey` once.
- Discover models from the configured base URL instead of hard-coding supported
  OpenAI models.
- Let users create multiple project-selectable providers from one connection,
  each with one selected model.
- Keep the Project AI pane simple: projects select configured providers only.
- Support official OpenAI and other OpenAI-compatible APIs that expose
  `/chat/completions` and `/models`.
- Preserve clear runtime errors when no usable provider is configured.

## Non-Goals

- Do not add model selection controls to the Project AI pane.
- Do not maintain a strict built-in model allowlist.
- Do not introduce provider-specific non-OpenAI protocols in this change.
- Do not migrate old built-in model choices into equivalent new provider records.

## Data Model

The app keeps using `app_settings` as the storage boundary for AI configuration.
No schema change is required for this slice.

### Connection Catalog

Store connection metadata in a new JSON setting:

- key: `ai_connection_catalog_v1`
- value: JSON array of connection records

Connection record shape:

```ts
interface StoredAIConnection {
  id: string; // connection:<uuid>
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
```

Connection API keys are stored separately:

- key prefix: `ai_connection_key::`
- full key: `ai_connection_key::<connectionId>`
- value: raw API key

### Provider Catalog

Store project-selectable provider records in a new JSON setting:

- key: `ai_provider_catalog_v2`
- value: JSON array of provider records

Provider record shape:

```ts
interface StoredAIProvider {
  id: string; // provider:<uuid>
  name: string;
  connectionId: string;
  model: string;
  protocol: 'chat-completions';
  kind: 'configured';
  createdAt: string;
  updatedAt: string;
}
```

`projects.aiModel` remains the project field used to persist the selected
provider id. Its short-term meaning becomes "selected configured provider id".
The column name can be renamed in a later schema cleanup, but this design avoids
a schema migration.

## Settings Flow

Settings owns provider management.

1. User creates or edits an AI connection by entering `name`, `baseUrl`, and
   `apiKey`.
2. `Test Connection` performs a minimal `/chat/completions` request.
3. If the chat test succeeds, the app calls `${baseUrl}/models`.
4. The returned model ids are lightly filtered to remove obvious non-text models.
5. A successful test saves or updates the connection, including the filtered
   `discoveredModels` list and API key last4.
6. User selects one model from that connection's discovered model list.
7. User enters or accepts a default provider name such as
   `OpenAI / gpt-5.4`.
8. `Add Provider` creates a provider record referencing the connection and model.

The same connection can create many providers. This allows one OpenAI key to
support multiple project-selectable providers without re-entering the key.

## Project Flow

The Project AI pane lists configured providers only.

- Provider option label should show provider name.
- Supporting metadata may show connection name and model where useful.
- The pane does not expose base URL, API key, model discovery, or model selection.
- If the saved provider id is unavailable, the UI should show a clear warning and
  require saving a valid configured provider before AI actions are available.
- If no providers exist, AI actions should be disabled with a message directing
  the user to Settings.

## Model Discovery

Model discovery uses OpenAI-compatible endpoints:

- Chat test: `POST ${baseUrl}/chat/completions`
- Model list: `GET ${baseUrl}/models`

The transport should normalize trailing slashes on `baseUrl`, redact credentials
from error messages, and avoid logging raw API keys.

Light filtering removes model ids that clearly are not useful for this app's
text/chat-completions workflow. The initial deny patterns should include:

- `embedding`
- `embed`
- `audio`
- `tts`
- `whisper`
- `image`
- `vision` only when the id is clearly image-only

All other returned model ids remain available. This intentionally avoids another
hard-coded allowlist.

If `/chat/completions` succeeds but `/models` fails, the test fails. Model
selection must come from discovered models for this design.

## Runtime Resolution

Runtime provider resolution becomes:

1. Normalize the project value from `projects.aiModel`.
2. Look up the provider in `ai_provider_catalog_v2`.
3. Look up the referenced connection in `ai_connection_catalog_v1`.
4. Read the connection API key from `ai_connection_key::<connectionId>`.
5. Send requests using `connection.baseUrl` and `provider.model`.

`MTModule`, desktop AI workflows, and CLI/headless flows should all use this same
provider catalog behavior.

## Compatibility

Existing custom providers in `ai_provider_catalog_v1` are read through a
read-only compatibility view. Each old custom provider can appear as:

- one connection using its old `baseUrl` and old API key
- one provider using its old `model`

Existing global `openai_api_key` may seed a default OpenAI-compatible connection
with:

- name: `OpenAI`
- baseUrl: `https://api.openai.com/v1`

It must not create the old four built-in model providers.

Existing built-in ids such as `builtin:openai:gpt-5.4-mini` are no longer treated
as concrete providers. Projects that reference old built-in ids resolve to the
first available configured provider by creation order. If no configured provider
exists, resolution fails with a clear setup error.

The compatibility layer should avoid writing converted data until the user saves
that connection/provider or the implementation provides an explicit one-time
upgrade path. This keeps the first implementation reversible and inspectable.

## Deletion Rules

- Deleting a connection is blocked while providers reference it.
- Deleting a provider is blocked while any project references it.
- Clearing a connection key makes all providers under it unusable until a key is
  saved and tested again.

## Error Handling

- Connection test failure: do not update discovered models; show a short
  redacted error.
- `/models` failure after chat success: fail the test and explain that model
  discovery failed.
- Empty model list after filtering: fail the test with "No usable text models
  were discovered."
- Missing provider at runtime: return "AI provider is not configured."
- Missing connection at runtime: return "AI provider connection is missing."
- Missing API key at runtime: return "API key is missing for connection
  \"<name>\"."

## Testing

Provider catalog and transport tests should cover:

- connection creation, key storage, and key last4 display
- chat test plus `/models` discovery
- model filtering behavior
- provider creation from a connection model
- provider and connection deletion protections
- runtime resolution from provider id to `baseUrl + apiKey + model`
- old custom provider compatibility
- old built-in id fallback to first configured provider
- clear error when no configured provider exists

Renderer tests should cover:

- Settings connection test and model discovery flow
- provider creation from a discovered model
- Project pane listing only configured providers
- Project pane unavailable-provider and no-provider states

CLI/headless tests should cover:

- inspection output for configured providers and connection-backed models
- translation config resolution without relying on the old four built-in models
- explicit setup error when no provider can be resolved

## Documentation Updates

Update the following docs when implementing:

- `DOCS/30_DATA_MODEL.md`
- `DOCS/agent-first/CLI.md`
- `DOCS/agent-first/MT_MODULE.md`
- `DOCS/40_STATUS_AND_ROADMAP.md` if this closes the provider pluggability item
