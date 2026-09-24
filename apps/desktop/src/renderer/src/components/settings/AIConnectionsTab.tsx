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
    <div className="space-y-6">
      <section className="workspace-settings-section">
        <h3 className="workspace-settings-heading">Connection details</h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="workspace-settings-label">Connection name</label>
            <Input
              aria-label="Connection name"
              type="text"
              value={controller.connectionNameInput}
              onChange={(event) => controller.updateConnectionName(event.target.value)}
              disabled={controller.testingProvider}
              placeholder="OpenAI"
            />
          </div>
          <div>
            <label className="workspace-settings-label">API base URL</label>
            <Input
              aria-label="API base URL"
              type="text"
              value={controller.connectionBaseUrlInput}
              onChange={(event) => controller.updateConnectionBaseUrl(event.target.value)}
              disabled={controller.testingProvider}
              placeholder="https://api.openai.com/v1"
            />
          </div>
        </div>

        <div>
          <label className="workspace-settings-label">API key</label>
          <Input
            aria-label="API key"
            type="password"
            value={controller.connectionApiKeyInput}
            onChange={(event) => controller.updateConnectionApiKey(event.target.value)}
            disabled={controller.testingProvider}
            placeholder={controller.apiKeyPlaceholder}
          />
        </div>

        <div className="flex justify-end">
          <Button
            variant="secondary"
            onClick={() => void controller.testConnection()}
            disabled={busy || controller.savedConnectionReuseActive}
          >
            {controller.testingProvider
              ? 'Testing...'
              : controller.savedConnectionReuseActive
                ? 'Enter key to retest'
                : 'Test connection'}
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="workspace-settings-label">Model</label>
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
            <label className="workspace-settings-label">Provider name</label>
            <Input
              aria-label="Provider name"
              type="text"
              value={controller.providerNameInput}
              onChange={(event) => controller.updateProviderName(event.target.value)}
              placeholder="OpenAI / gpt-demo"
              disabled={busy || !controller.testedConnection}
            />
          </div>
        </div>

        <div className="workspace-settings-actions">
          <Button
            variant="primary"
            onClick={() => void controller.addProvider()}
            disabled={busy || !controller.testedConnection || !controller.selectedModel}
          >
            {controller.addingProvider ? 'Adding provider...' : 'Add provider'}
          </Button>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="workspace-settings-heading">Saved connections</h3>
        <div className="space-y-2">
          {controller.connections.length === 0 ? (
            <div className="py-3 text-xs text-text-muted">No AI connections saved.</div>
          ) : (
            controller.connections.map((connectionItem) => {
              const isDeleting = controller.deletingConnectionId === connectionItem.id;
              return (
                <div
                  key={connectionItem.id}
                  className="workspace-config-section flex flex-wrap items-center justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="break-words text-sm font-medium text-text">
                        {connectionItem.name}
                      </span>
                      <span className="shrink-0 text-xs text-text-muted">
                        {formatModelCount(connectionItem.discoveredModels.length)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-text-muted break-all">
                      {connectionItem.baseUrl}
                    </div>
                    <div className="mt-1 text-xs text-text-muted">
                      API key:{' '}
                      {connectionItem.apiKeyLast4
                        ? `****${connectionItem.apiKeyLast4}`
                        : 'Not configured'}
                    </div>
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => controller.useConnection(connectionItem)}
                      disabled={busy || connectionItem.discoveredModels.length === 0}
                      size="sm"
                    >
                      Use connection
                    </Button>
                    <Button
                      variant="ghost"
                      tone="danger"
                      onClick={() => void controller.deleteConnection(connectionItem.id)}
                      disabled={busy}
                      size="sm"
                    >
                      {isDeleting ? 'Deleting...' : 'Delete connection'}
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="workspace-settings-heading">Providers</h3>
        <div className="space-y-2">
          {controller.providers.length === 0 ? (
            <div className="py-3 text-xs text-text-muted">No AI providers configured.</div>
          ) : (
            controller.providers.map((provider) => {
              const isDeleting = controller.deletingProviderId === provider.id;
              return (
                <div
                  key={provider.id}
                  className="workspace-config-section flex flex-wrap items-center justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="break-words text-sm font-medium text-text">
                        {provider.name}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-text-muted break-all">
                      {provider.baseUrl} - {provider.model}
                    </div>
                    <div className="mt-1 text-xs text-text-muted">
                      Connection: {provider.connectionName || 'Legacy'} - Key{' '}
                      {provider.apiKeyLast4 ? `****${provider.apiKeyLast4}` : 'not configured'}
                    </div>
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    {provider.kind === 'configured' ? (
                      <Button
                        variant="ghost"
                        tone="danger"
                        onClick={() => void controller.deleteProvider(provider.id)}
                        disabled={busy}
                        size="sm"
                      >
                        {isDeleting ? 'Deleting...' : 'Delete provider'}
                      </Button>
                    ) : (
                      <span className="text-xs text-text-muted">Read only</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
