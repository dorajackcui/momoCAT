import { Input, Button, Select } from '../ui';
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
            <Input
              aria-label="Connection Name"
              type="text"
              value={controller.connectionNameInput}
              onChange={(event) => controller.updateConnectionName(event.target.value)}
              disabled={controller.testingProvider}
              placeholder="OpenAI"
            />
          </div>
          <div>
            <label className="field-label">API Base URL</label>
            <Input
              aria-label="API Base URL"
              type="text"
              value={controller.connectionBaseUrlInput}
              onChange={(event) => controller.updateConnectionBaseUrl(event.target.value)}
              disabled={controller.testingProvider}
              placeholder="https://api.openai.com/v1"
            />
          </div>
        </div>

        <div>
          <label className="field-label">API Key</label>
          <Input
            aria-label="API Key"
            type="password"
            value={controller.connectionApiKeyInput}
            onChange={(event) => controller.updateConnectionApiKey(event.target.value)}
            disabled={controller.testingProvider}
            placeholder={controller.apiKeyPlaceholder}
          />
        </div>

        <Button
          variant="secondary"
          onClick={() => void controller.testConnection()}
          disabled={busy || controller.savedConnectionReuseActive}
          className="w-full"
        >
          {controller.testingProvider
            ? 'Testing...'
            : controller.savedConnectionReuseActive
              ? 'Enter Key to Retest'
              : 'Test Connection'}
        </Button>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="field-label">Model</label>
            <Select
              aria-label="Model"
              value={controller.selectedModel}
              onChange={(event) => controller.changeModel(event.target.value)}
              disabled={busy || !controller.testedConnection}
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
            </Select>
          </div>
          <div>
            <label className="field-label">Provider Name</label>
            <Input
              aria-label="Provider Name"
              type="text"
              value={controller.providerNameInput}
              onChange={(event) => controller.updateProviderName(event.target.value)}
              placeholder="OpenAI / gpt-demo"
              disabled={busy || !controller.testedConnection}
            />
          </div>
        </div>

        <Button
          variant="primary"
          onClick={() => void controller.addProvider()}
          disabled={busy || !controller.testedConnection || !controller.selectedModel}
          className="w-full"
        >
          {controller.addingProvider ? 'Adding Provider...' : 'Add Provider'}
        </Button>
      </section>

      <section className="surface-card p-4 space-y-3">
        <h3 className="text-sm font-bold text-text">Connections</h3>
        <div className="space-y-2">
          {controller.connections.length === 0 ? (
            <div className="surface-subtle px-3 py-4 text-sm text-text-muted">
              No AI connections saved.
            </div>
          ) : (
            controller.connections.map((connectionItem) => {
              const isDeleting = controller.deletingConnectionId === connectionItem.id;
              return (
                <div
                  key={connectionItem.id}
                  className="surface-subtle px-3 py-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-text">{connectionItem.name}</span>
                      <span className="text-caption uppercase tracking-wider text-text-faint">
                        {formatModelCount(connectionItem.discoveredModels.length)}
                      </span>
                    </div>
                    <div className="text-2xs text-text-muted break-all">
                      {connectionItem.baseUrl}
                    </div>
                    <div className="text-2xs text-text-faint">
                      API Key:{' '}
                      {connectionItem.apiKeyLast4
                        ? `****${connectionItem.apiKeyLast4}`
                        : 'Not configured'}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 md:flex-row md:items-center">
                    <Button
                      variant="secondary"
                      onClick={() => controller.useConnection(connectionItem)}
                      disabled={busy || connectionItem.discoveredModels.length === 0}
                      className="md:w-auto"
                    >
                      Use Connection
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => void controller.deleteConnection(connectionItem.id)}
                      disabled={busy}
                      className="md:w-auto"
                    >
                      {isDeleting ? 'Deleting...' : 'Delete Connection'}
                    </Button>
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
            <div className="surface-subtle px-3 py-4 text-sm text-text-muted">
              No AI providers configured.
            </div>
          ) : (
            controller.providers.map((provider) => {
              const isDeleting = controller.deletingProviderId === provider.id;
              return (
                <div
                  key={provider.id}
                  className="surface-subtle px-3 py-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-text">{provider.name}</span>
                      <span className="text-caption uppercase tracking-wider text-text-faint">
                        {provider.kind}
                      </span>
                    </div>
                    <div className="text-2xs text-text-muted break-all">
                      {provider.baseUrl} - {provider.model}
                    </div>
                    <div className="text-2xs text-text-faint">
                      Connection: {provider.connectionName || 'Legacy'} - Key{' '}
                      {provider.apiKeyLast4 ? `****${provider.apiKeyLast4}` : 'not configured'}
                    </div>
                  </div>
                  {provider.kind === 'configured' ? (
                    <Button
                      variant="secondary"
                      onClick={() => void controller.deleteProvider(provider.id)}
                      disabled={busy}
                      className="md:w-auto"
                    >
                      {isDeleting ? 'Deleting...' : 'Delete Provider'}
                    </Button>
                  ) : (
                    <span className="text-2xs font-medium uppercase tracking-wider text-text-faint">
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
