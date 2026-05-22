import React, { useEffect, useState } from 'react';
import type {
  AIConnectionSummary,
  AIProviderSummary,
  ProxyMode,
  ProxySettings,
} from '../../../shared/ipc';
import { apiClient } from '../services/apiClient';
import { notifyAIProvidersChanged } from '../services/aiProviderEvents';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTabId = 'connections' | 'proxy';

const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string }> = [
  { id: 'connections', label: 'AI Connections' },
  { id: 'proxy', label: 'Proxy' },
];

function formatModelCount(count: number): string {
  return `${count} ${count === 1 ? 'model' : 'models'}`;
}

function buildProviderName(connection: AIConnectionSummary, model: string): string {
  return model ? `${connection.name} / ${model}` : connection.name;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('connections');
  const [connections, setConnections] = useState<AIConnectionSummary[]>([]);
  const [providers, setProviders] = useState<AIProviderSummary[]>([]);
  const [connectionNameInput, setConnectionNameInput] = useState('');
  const [connectionBaseUrlInput, setConnectionBaseUrlInput] = useState('');
  const [connectionApiKeyInput, setConnectionApiKeyInput] = useState('');
  const [testedConnection, setTestedConnection] = useState<AIConnectionSummary | null>(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [providerNameInput, setProviderNameInput] = useState('');
  const [proxyMode, setProxyMode] = useState<ProxyMode>('system');
  const [customProxyUrl, setCustomProxyUrl] = useState('');
  const [effectiveProxyUrl, setEffectiveProxyUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingProxy, setSavingProxy] = useState(false);
  const [testingProvider, setTestingProvider] = useState(false);
  const [addingProvider, setAddingProvider] = useState(false);
  const [deletingConnectionId, setDeletingConnectionId] = useState<string | null>(null);
  const [deletingProviderId, setDeletingProviderId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const resetTestedConnection = () => {
    const hadTestedState =
      testedConnection !== null || selectedModel.length > 0 || providerNameInput.length > 0;
    setTestedConnection(null);
    setSelectedModel('');
    setProviderNameInput('');
    if (hadTestedState) {
      setStatus('Connection details changed. Test the connection again.');
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    setActiveTab('connections');
    setStatus(null);
    setConnectionNameInput('');
    setConnectionBaseUrlInput('');
    setConnectionApiKeyInput('');
    setTestedConnection(null);
    setSelectedModel('');
    setProviderNameInput('');

    const load = async () => {
      setLoading(true);
      try {
        const [proxySettings, connectionList, providerList] = await Promise.all([
          apiClient.getProxySettings(),
          apiClient.listAIConnections(),
          apiClient.listAIProviders(),
        ]);

        setProxyMode(proxySettings.mode);
        setCustomProxyUrl(proxySettings.customProxyUrl);
        setEffectiveProxyUrl(proxySettings.effectiveProxyUrl ?? null);
        setConnections(connectionList);
        setProviders(providerList);
      } catch {
        setProxyMode('system');
        setCustomProxyUrl('');
        setEffectiveProxyUrl(null);
        setConnections([]);
        setProviders([]);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [isOpen]);

  if (!isOpen) return null;

  const busy =
    loading ||
    savingProxy ||
    testingProvider ||
    addingProvider ||
    deletingConnectionId !== null ||
    deletingProviderId !== null;

  const reloadConnectionsAndProviders = async () => {
    const [connectionList, providerList] = await Promise.all([
      apiClient.listAIConnections(),
      apiClient.listAIProviders(),
    ]);
    setConnections(connectionList);
    setProviders(providerList);
  };

  const applyProxySettings = async (): Promise<ProxySettings> => {
    const updated = await apiClient.setProxySettings({
      mode: proxyMode,
      customProxyUrl,
    });
    setProxyMode(updated.mode);
    setCustomProxyUrl(updated.customProxyUrl);
    setEffectiveProxyUrl(updated.effectiveProxyUrl ?? null);
    return updated;
  };

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
        setProviderNameInput('');
        setStatus(`Connection test failed: ${result.error || 'Unknown error'}`);
        return;
      }

      const firstModel = result.connection.discoveredModels[0] ?? '';
      setTestedConnection(result.connection);
      setSelectedModel(firstModel);
      setProviderNameInput(buildProviderName(result.connection, firstModel));
      try {
        await reloadConnectionsAndProviders();
      } catch {
        // Keep the successful test result usable even if refreshing saved lists fails.
      }
      setStatus(`Connection tested: ${result.connection.discoveredModels.length} models discovered.`);
    } catch (error) {
      setTestedConnection(null);
      setSelectedModel('');
      setProviderNameInput('');
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Connection test failed: ${message}`);
    } finally {
      setTestingProvider(false);
    }
  };

  const handleModelChange = (model: string) => {
    const previousModel = selectedModel;
    setSelectedModel(model);

    if (!testedConnection) return;

    const previousDefault = buildProviderName(testedConnection, previousModel);
    if (!providerNameInput.trim() || providerNameInput === previousDefault) {
      setProviderNameInput(buildProviderName(testedConnection, model));
    }
  };

  const handleAddProvider = async () => {
    if (!testedConnection || !selectedModel) {
      setStatus('Test a connection and choose a model before adding a provider.');
      return;
    }

    setAddingProvider(true);
    setStatus(null);
    try {
      await apiClient.addAIProvider({
        name: providerNameInput.trim() || buildProviderName(testedConnection, selectedModel),
        connectionId: testedConnection.id,
        model: selectedModel,
      });
      await reloadConnectionsAndProviders();
      notifyAIProvidersChanged();
      setStatus('AI provider added.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed to add provider: ${message}`);
    } finally {
      setAddingProvider(false);
    }
  };

  const handleDeleteConnection = async (connectionId: string) => {
    setDeletingConnectionId(connectionId);
    setStatus(null);
    try {
      await apiClient.deleteAIConnection(connectionId);
      await reloadConnectionsAndProviders();
      if (testedConnection?.id === connectionId) {
        setTestedConnection(null);
        setSelectedModel('');
        setProviderNameInput('');
      }
      notifyAIProvidersChanged();
      setStatus('AI connection deleted.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed to delete connection: ${message}`);
    } finally {
      setDeletingConnectionId(null);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    setDeletingProviderId(providerId);
    setStatus(null);
    try {
      await apiClient.deleteAIProvider(providerId);
      await reloadConnectionsAndProviders();
      notifyAIProvidersChanged();
      setStatus('AI provider deleted.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed to delete provider: ${message}`);
    } finally {
      setDeletingProviderId(null);
    }
  };

  const handleSaveProxy = async () => {
    setSavingProxy(true);
    setStatus(null);
    try {
      const proxySettings = await applyProxySettings();
      if (proxySettings.effectiveProxyUrl) {
        setStatus(`Proxy applied: ${proxySettings.effectiveProxyUrl}`);
      } else {
        setStatus('Proxy disabled. Direct connection will be used.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed to save proxy settings: ${message}`);
    } finally {
      setSavingProxy(false);
    }
  };

  const renderConnectionsTab = () => (
    <div className="space-y-4">
      <section className="surface-card p-4 space-y-3">
        <h3 className="text-sm font-bold text-text">AI Connections</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="field-label">Connection Name</label>
            <input
              aria-label="Connection Name"
              type="text"
              value={connectionNameInput}
              onChange={(event) => {
                setConnectionNameInput(event.target.value);
                resetTestedConnection();
              }}
              disabled={testingProvider}
              placeholder="OpenAI"
              className="field-input"
            />
          </div>
          <div>
            <label className="field-label">API Base URL</label>
            <input
              aria-label="API Base URL"
              type="text"
              value={connectionBaseUrlInput}
              onChange={(event) => {
                setConnectionBaseUrlInput(event.target.value);
                resetTestedConnection();
              }}
              disabled={testingProvider}
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
            value={connectionApiKeyInput}
            onChange={(event) => {
              setConnectionApiKeyInput(event.target.value);
              resetTestedConnection();
            }}
            disabled={testingProvider}
            placeholder="sk-..."
            className="field-input"
          />
        </div>

        <button onClick={handleTestConnection} disabled={busy} className="btn-secondary w-full">
          {testingProvider ? 'Testing...' : 'Test Connection'}
        </button>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="field-label">Model</label>
            <select
              aria-label="Model"
              value={selectedModel}
              onChange={(event) => handleModelChange(event.target.value)}
              disabled={busy || !testedConnection}
              className="field-input"
            >
              {testedConnection ? (
                testedConnection.discoveredModels.map((model) => (
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
              value={providerNameInput}
              onChange={(event) => setProviderNameInput(event.target.value)}
              placeholder="OpenAI / gpt-demo"
              disabled={busy || !testedConnection}
              className="field-input"
            />
          </div>
        </div>

        <button
          onClick={handleAddProvider}
          disabled={busy || !testedConnection || !selectedModel}
          className="btn-primary w-full"
        >
          {addingProvider ? 'Adding Provider...' : 'Add Provider'}
        </button>
      </section>

      <section className="surface-card p-4 space-y-3">
        <h3 className="text-sm font-bold text-text">Connections</h3>
        <div className="space-y-2">
          {connections.length === 0 ? (
            <div className="surface-subtle rounded-xl px-3 py-4 text-sm text-text-muted">
              No AI connections saved.
            </div>
          ) : (
            connections.map((connectionItem) => {
              const isDeleting = deletingConnectionId === connectionItem.id;
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
                      {connectionItem.apiKeyLast4 ? `****${connectionItem.apiKeyLast4}` : 'Not configured'}
                    </div>
                  </div>
                  <button
                    onClick={() => void handleDeleteConnection(connectionItem.id)}
                    disabled={busy}
                    className="btn-secondary md:w-auto disabled:opacity-50"
                  >
                    {isDeleting ? 'Deleting...' : 'Delete Connection'}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="surface-card p-4 space-y-3">
        <h3 className="text-sm font-bold text-text">AI Providers</h3>
        <div className="space-y-2">
          {providers.length === 0 ? (
            <div className="surface-subtle rounded-xl px-3 py-4 text-sm text-text-muted">
              No AI providers configured.
            </div>
          ) : (
            providers.map((provider) => {
              const isDeleting = deletingProviderId === provider.id;
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
                  <button
                    onClick={() => void handleDeleteProvider(provider.id)}
                    disabled={busy}
                    className="btn-secondary md:w-auto disabled:opacity-50"
                  >
                    {isDeleting ? 'Deleting...' : 'Delete Provider'}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );

  const renderProxyTab = () => (
    <section className="surface-card p-4 space-y-3">
      <h3 className="text-sm font-bold text-text">Proxy Settings</h3>
      <div className="space-y-2 text-sm text-text-muted">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="proxy-mode"
            checked={proxyMode === 'off'}
            onChange={() => setProxyMode('off')}
            className="accent-brand"
          />
          <span>No Proxy (Direct)</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="proxy-mode"
            checked={proxyMode === 'system'}
            onChange={() => setProxyMode('system')}
            className="accent-brand"
          />
          <span>Use System/Environment Proxy</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="proxy-mode"
            checked={proxyMode === 'custom'}
            onChange={() => setProxyMode('custom')}
            className="accent-brand"
          />
          <span>Use Custom Proxy URL</span>
        </label>
      </div>

      {proxyMode === 'custom' && (
        <input
          aria-label="Custom Proxy URL"
          type="text"
          value={customProxyUrl}
          onChange={(event) => setCustomProxyUrl(event.target.value)}
          placeholder="http://127.0.0.1:7890"
          className="field-input"
        />
      )}

      <p className="text-[11px] text-text-muted">Active proxy: {effectiveProxyUrl || 'None (direct)'}</p>

      <button onClick={handleSaveProxy} disabled={busy} className="btn-secondary w-full">
        {savingProxy ? 'Saving Proxy...' : 'Save Proxy Settings'}
      </button>
    </section>
  );

  return (
    <div className="modal-backdrop">
      <div className="modal-card max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="modal-header">
          <h2 className="text-xl font-bold text-text">AI & Network Settings</h2>
          <button
            onClick={onClose}
            className="text-text-faint hover:text-text-muted transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="px-6 py-3 border-b border-border flex gap-2 overflow-x-auto">
          {SETTINGS_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={
                  isActive
                    ? 'px-3 py-2 rounded-control text-sm font-semibold bg-brand text-white whitespace-nowrap'
                    : 'px-3 py-2 rounded-control text-sm font-medium text-text-muted hover:text-text hover:bg-muted transition-colors whitespace-nowrap'
                }
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div
          className="modal-body flex-1 overflow-y-auto space-y-4"
          style={{ scrollbarGutter: 'stable' }}
        >
          {activeTab === 'connections' && renderConnectionsTab()}
          {activeTab === 'proxy' && renderProxyTab()}
          {status && <div className="status-note">{status}</div>}
        </div>
      </div>
    </div>
  );
}
