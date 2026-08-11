import type { AIConnectionsController } from './useAIConnectionsController';

interface AIConnectionsTabProps {
  controller: AIConnectionsController;
  busy: boolean;
}

function formatModelCount(count: number): string {
  return `${count} ${count === 1 ? 'model' : 'models'}`;
}

export function AIConnectionsTab({ controller, busy }: AIConnectionsTabProps) {
  return (
    <div className="space-y-4">
      <section className="surface-card p-4 space-y-3">
        <h3 className="text-sm font-bold text-text">AI Connections</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="field-label">Connection Name</label>
            <input
              aria-label="Connection Name"
              type="text"
              value={controller.connectionNameInput}
              onChange={(event) => controller.updateConnectionName(event.target.value)}
              disabled={controller.testingProvider}
              placeholder="OpenAI"
              className="field-input"
            />
          </div>
          <div>
            <label className="field-label">API Base URL</label>
            <input
              aria-label="API Base URL"
              type="text"
              value={controller.connectionBaseUrlInput}
              onChange={(event) => controller.updateConnectionBaseUrl(event.target.value)}
              disabled={controller.testingProvider}
              placeholder="https://api.openai.com/v1"
              className="field-input"
            />
          </div>
        </div>

        <div>
          <label className="field-label">API Key</label>
          <input
            aria-label="API Key"
            type="password"
            value={controller.connectionApiKeyInput}
            onChange={(event) => controller.updateConnectionApiKey(event.target.value)}
            disabled={controller.testingProvider}
            placeholder={controller.apiKeyPlaceholder}
            className="field-input"
          />
        </div>

        <button
          onClick={() => void controller.testConnection()}
          disabled={busy || controller.savedConnectionReuseActive}
          className="btn-secondary w-full"
        >
          {controller.testingProvider
            ? 'Testing...'
            : controller.savedConnectionReuseActive
              ? 'Enter Key to Retest'
              : 'Test Connection'}
        </button>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="field-label">Model</label>
            <select
              aria-label="Model"
              value={controller.selectedModel}
              onChange={(event) => controller.changeModel(event.target.value)}
              disabled={busy || !controller.testedConnection}
              className="field-input"
            >
              {controller.testedConnection ? (
                controller.testedConnection.discoveredModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))
              ) : (
                <option value="">No models discovered</option>
              )}
            </select>
          </div>
          <div>
            <label className="field-label">Provider Name</label>
            <input
              aria-label="Provider Name"
              type="text"
              value={controller.providerNameInput}
              onChange={(event) => controller.updateProviderName(event.target.value)}
              placeholder="OpenAI / gpt-demo"
              disabled={busy || !controller.testedConnection}
              className="field-input"
            />
          </div>
        </div>

        <button
          onClick={() => void controller.addProvider()}
          disabled={busy || !controller.testedConnection || !controller.selectedModel}
          className="btn-primary w-full"
        >
          {controller.addingProvider ? 'Adding Provider...' : 'Add Provider'}
        </button>
      </section>

      <section className="surface-card p-4 space-y-3">
        <h3 className="text-sm font-bold text-text">Connections</h3>
        <div className="space-y-2">
          {controller.connections.length === 0 ? (
            <div className="surface-subtle rounded-xl px-3 py-4 text-sm text-text-muted">
              No AI connections saved.
            </div>
          ) : (
            controller.connections.map((connectionItem) => {
              const isDeleting = controller.deletingConnectionId === connectionItem.id;
              return (
                <div
                  key={connectionItem.id}
                  className="surface-subtle rounded-xl px-3 py-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-text">{connectionItem.name}</span>
                      <span className="text-[10px] uppercase tracking-wider text-text-faint">
                        {formatModelCount(connectionItem.discoveredModels.length)}
                      </span>
                    </div>
                    <div className="text-[11px] text-text-muted break-all">
                      {connectionItem.baseUrl}
                    </div>
                    <div className="text-[11px] text-text-faint">
                      API Key:{' '}
                      {connectionItem.apiKeyLast4
                        ? `****${connectionItem.apiKeyLast4}`
                        : 'Not configured'}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 md:flex-row md:items-center">
                    <button
                      onClick={() => controller.useConnection(connectionItem)}
                      disabled={busy || connectionItem.discoveredModels.length === 0}
                      className="btn-secondary md:w-auto disabled:opacity-50"
                    >
                      Use Connection
                    </button>
                    <button
                      onClick={() => void controller.deleteConnection(connectionItem.id)}
                      disabled={busy}
                      className="btn-secondary md:w-auto disabled:opacity-50"
                    >
                      {isDeleting ? 'Deleting...' : 'Delete Connection'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="surface-card p-4 space-y-3">
        <h3 className="text-sm font-bold text-text">AI Providers</h3>
        <div className="space-y-2">
          {controller.providers.length === 0 ? (
            <div className="surface-subtle rounded-xl px-3 py-4 text-sm text-text-muted">
              No AI providers configured.
            </div>
          ) : (
            controller.providers.map((provider) => {
              const isDeleting = controller.deletingProviderId === provider.id;
              return (
                <div
                  key={provider.id}
                  className="surface-subtle rounded-xl px-3 py-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-text">{provider.name}</span>
                      <span className="text-[10px] uppercase tracking-wider text-text-faint">
                        {provider.kind}
                      </span>
                    </div>
                    <div className="text-[11px] text-text-muted break-all">
                      {provider.baseUrl} - {provider.model}
                    </div>
                    <div className="text-[11px] text-text-faint">
                      Connection: {provider.connectionName || 'Legacy'} - Key{' '}
                      {provider.apiKeyLast4 ? `****${provider.apiKeyLast4}` : 'not configured'}
                    </div>
                  </div>
                  {provider.kind === 'configured' ? (
                    <button
                      onClick={() => void controller.deleteProvider(provider.id)}
                      disabled={busy}
                      className="btn-secondary md:w-auto disabled:opacity-50"
                    >
                      {isDeleting ? 'Deleting...' : 'Delete Provider'}
                    </button>
                  ) : (
                    <span className="text-[11px] font-medium uppercase tracking-wider text-text-faint">
                      Read only
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
