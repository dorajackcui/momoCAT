import React, { useEffect, useMemo, useState } from 'react';
import type { AIProviderSummary, ProxyMode, ProxySettings } from '../../../shared/ipc';
import { apiClient } from '../services/apiClient';
import { notifyAIProvidersChanged } from '../services/aiProviderEvents';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTabId = 'openai' | 'providers' | 'proxy';

const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string }> = [
  { id: 'openai', label: 'OpenAI Key' },
  { id: 'providers', label: 'Custom Providers' },
  { id: 'proxy', label: 'Proxy' },
];

function buildProviderFormSignature(params: {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}): string {
  return JSON.stringify([
    params.name.trim(),
    params.baseUrl.trim(),
    params.apiKey.trim(),
    params.model.trim(),
  ]);
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('openai');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyHint, setApiKeyHint] = useState<string | null>(null);
  const [proxyMode, setProxyMode] = useState<ProxyMode>('system');
  const [customProxyUrl, setCustomProxyUrl] = useState('');
  const [effectiveProxyUrl, setEffectiveProxyUrl] = useState<string | null>(null);
  const [providerNameInput, setProviderNameInput] = useState('');
  const [providerBaseUrlInput, setProviderBaseUrlInput] = useState('');
  const [providerApiKeyInput, setProviderApiKeyInput] = useState('');
  const [providerModelInput, setProviderModelInput] = useState('');
  const [providers, setProviders] = useState<AIProviderSummary[]>([]);
  const [lastSuccessfulProviderSignature, setLastSuccessfulProviderSignature] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [savingProxy, setSavingProxy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingProvider, setTestingProvider] = useState(false);
  const [addingProvider, setAddingProvider] = useState(false);
  const [deletingProviderId, setDeletingProviderId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const currentProviderSignature = useMemo(
    () =>
      buildProviderFormSignature({
        name: providerNameInput,
        baseUrl: providerBaseUrlInput,
        apiKey: providerApiKeyInput,
        model: providerModelInput,
      }),
    [providerApiKeyInput, providerBaseUrlInput, providerModelInput, providerNameInput],
  );

  const canAddProvider =
    lastSuccessfulProviderSignature !== null &&
    lastSuccessfulProviderSignature === currentProviderSignature;

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab('openai');
    setStatus(null);
    setApiKeyInput('');
    setProviderNameInput('');
    setProviderBaseUrlInput('');
    setProviderApiKeyInput('');
    setProviderModelInput('');
    setLastSuccessfulProviderSignature(null);

    const load = async () => {
      try {
        const [aiSettings, proxySettings, providerList] = await Promise.all([
          apiClient.getAISettings(),
          apiClient.getProxySettings(),
          apiClient.listAIProviders(),
        ]);

        if (aiSettings.apiKeySet && aiSettings.apiKeyLast4) {
          setApiKeyHint(`****${aiSettings.apiKeyLast4}`);
        } else {
          setApiKeyHint(null);
        }

        setProxyMode(proxySettings.mode);
        setCustomProxyUrl(proxySettings.customProxyUrl);
        setEffectiveProxyUrl(proxySettings.effectiveProxyUrl ?? null);
        setProviders(providerList);
      } catch {
        setApiKeyHint(null);
        setProxyMode('system');
        setCustomProxyUrl('');
        setEffectiveProxyUrl(null);
        setProviders([]);
      }
    };

    void load();
  }, [isOpen]);

  if (!isOpen) return null;

  const busy =
    loading ||
    clearing ||
    testing ||
    savingProxy ||
    testingProvider ||
    addingProvider ||
    deletingProviderId !== null;

  const reloadProviders = async () => {
    const providerList = await apiClient.listAIProviders();
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

  const handleSave = async () => {
    const key = apiKeyInput.trim();
    if (!key) {
      setStatus('Please enter an API key.');
      return;
    }

    setLoading(true);
    setStatus(null);
    try {
      await apiClient.setAIKey(key);
      setApiKeyHint(`****${key.slice(-4)}`);
      setApiKeyInput('');
      await reloadProviders();
      notifyAIProvidersChanged();
      setStatus('API key saved. You can run a test now.');
    } catch {
      setStatus('Failed to save API key.');
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const proxySettings = await applyProxySettings();
      const key = apiKeyInput.trim() || undefined;
      await apiClient.testAIConnection(key);
      if (proxySettings.effectiveProxyUrl) {
        setStatus(`Connection successful via proxy: ${proxySettings.effectiveProxyUrl}`);
      } else {
        setStatus('Connection successful with direct connection.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Connection failed: ${message}`);
    } finally {
      setTesting(false);
    }
  };

  const handleTestProvider = async () => {
    setTestingProvider(true);
    setStatus(null);
    try {
      await applyProxySettings();
      const result = await apiClient.testAIProvider({
        name: providerNameInput,
        baseUrl: providerBaseUrlInput,
        apiKey: providerApiKeyInput,
        model: providerModelInput,
      });

      if (!result.ok) {
        setLastSuccessfulProviderSignature(null);
        setStatus(`Provider test failed: ${result.error || 'Unknown error'}`);
        return;
      }

      setLastSuccessfulProviderSignature(currentProviderSignature);
      setStatus(`Provider test succeeded: ${result.endpoint}`);
    } catch (error) {
      setLastSuccessfulProviderSignature(null);
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Provider test failed: ${message}`);
    } finally {
      setTestingProvider(false);
    }
  };

  const handleAddProvider = async () => {
    if (!canAddProvider) {
      setStatus('Please test this provider successfully before adding it.');
      return;
    }

    setAddingProvider(true);
    setStatus(null);
    try {
      await apiClient.addAIProvider({
        name: providerNameInput,
        baseUrl: providerBaseUrlInput,
        apiKey: providerApiKeyInput,
        model: providerModelInput,
      });
      await reloadProviders();
      notifyAIProvidersChanged();
      setProviderNameInput('');
      setProviderBaseUrlInput('');
      setProviderApiKeyInput('');
      setProviderModelInput('');
      setLastSuccessfulProviderSignature(null);
      setStatus('Custom AI provider added.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed to add provider: ${message}`);
    } finally {
      setAddingProvider(false);
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

  const handleClear = async () => {
    setClearing(true);
    setStatus(null);
    try {
      await apiClient.clearAIKey();
      setApiKeyHint(null);
      setApiKeyInput('');
      await reloadProviders();
      notifyAIProvidersChanged();
      setStatus('Saved API key removed.');
    } catch {
      setStatus('Failed to remove saved API key.');
    } finally {
      setClearing(false);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    setDeletingProviderId(providerId);
    setStatus(null);
    try {
      await apiClient.deleteAIProvider(providerId);
      await reloadProviders();
      notifyAIProvidersChanged();
      setStatus('Custom AI provider deleted.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed to delete provider: ${message}`);
    } finally {
      setDeletingProviderId(null);
    }
  };

  const renderOpenAIKeyTab = () => (
    <section className="surface-subtle p-4 space-y-3">
      <h3 className="text-sm font-bold text-text">OpenAI API Key</h3>
      <div>
        <label className="field-label">OpenAI API Key</label>
        <input
          aria-label="OpenAI API Key"
          type="password"
          value={apiKeyInput}
          onChange={(e) => setApiKeyInput(e.target.value)}
          placeholder="sk-..."
          className="field-input"
        />
        {apiKeyHint && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-text-muted">Saved key: {apiKeyHint}</p>
            <button
              onClick={handleClear}
              disabled={busy}
              className="text-[11px] font-semibold text-danger hover:text-danger-hover disabled:opacity-50 transition-colors"
            >
              {clearing ? 'Removing...' : 'Delete Saved Key'}
            </button>
          </div>
        )}
      </div>
      <div className="flex gap-3">
        <button onClick={handleTest} disabled={busy} className="btn-secondary flex-1">
          {testing ? 'Testing...' : 'Test Connection'}
        </button>
        <button onClick={handleSave} disabled={busy} className="btn-primary flex-1">
          {loading ? 'Saving...' : 'Save Key'}
        </button>
      </div>
    </section>
  );

  const renderProvidersTab = () => (
    <section className="surface-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-bold text-text">Custom AI Providers</h3>
        <span className="text-[11px] text-text-muted">
          Built-in OpenAI providers stay available alongside your custom providers.
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="field-label">Provider Name</label>
          <input
            aria-label="Provider Name"
            type="text"
            value={providerNameInput}
            onChange={(e) => setProviderNameInput(e.target.value)}
            placeholder="My OpenAI-Compatible API"
            className="field-input"
          />
        </div>
        <div>
          <label className="field-label">Model</label>
          <input
            aria-label="Model"
            type="text"
            value={providerModelInput}
            onChange={(e) => setProviderModelInput(e.target.value)}
            placeholder="gpt-4o-mini"
            className="field-input"
          />
        </div>
      </div>

      <div>
        <label className="field-label">API Base URL</label>
        <input
          aria-label="API Base URL"
          type="text"
          value={providerBaseUrlInput}
          onChange={(e) => setProviderBaseUrlInput(e.target.value)}
          placeholder="https://example.com/v1"
          className="field-input"
        />
      </div>

      <div>
        <label className="field-label">API Key</label>
        <input
          aria-label="API Key"
          type="password"
          value={providerApiKeyInput}
          onChange={(e) => setProviderApiKeyInput(e.target.value)}
          placeholder="provider secret"
          className="field-input"
        />
      </div>

      <div className="flex gap-3">
        <button onClick={handleTestProvider} disabled={busy} className="btn-secondary flex-1">
          {testingProvider ? 'Testing Provider...' : 'Test Provider'}
        </button>
        <button
          onClick={handleAddProvider}
          disabled={busy || !canAddProvider}
          className="btn-primary flex-1"
        >
          {addingProvider ? 'Adding Provider...' : 'Add Provider'}
        </button>
      </div>

      <div className="space-y-2">
        {providers.length === 0 ? (
          <div className="surface-subtle rounded-xl px-3 py-4 text-sm text-text-muted">
            No AI providers available yet.
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
                    API Key: {provider.apiKeyLast4 ? `****${provider.apiKeyLast4}` : 'Not configured'}
                  </div>
                </div>
                <button
                  onClick={() => void handleDeleteProvider(provider.id)}
                  disabled={busy || provider.kind === 'builtin'}
                  className="btn-secondary md:w-auto disabled:opacity-50"
                >
                  {provider.kind === 'builtin' ? 'Built-in' : isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            );
          })
        )}
      </div>
    </section>
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
          onChange={(e) => setCustomProxyUrl(e.target.value)}
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
          {activeTab === 'openai' && renderOpenAIKeyTab()}
          {activeTab === 'providers' && renderProvidersTab()}
          {activeTab === 'proxy' && renderProxyTab()}
          {status && <div className="status-note">{status}</div>}
        </div>
      </div>
    </div>
  );
}
