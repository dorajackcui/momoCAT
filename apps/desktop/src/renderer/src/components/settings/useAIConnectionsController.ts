import { useEffect, useState } from 'react';
import type { AIConnectionSummary, AIProviderSummary } from '../../../../shared/ipc';
import { chooseInitialProviderModel, isSavedConnectionReuseActive } from '../aiProviderSelection';
import { apiClient } from '../../services/apiClient';
import { notifyAIProvidersChanged } from '../../services/aiProviderEvents';
import type { ProxySettingsController } from './useProxySettingsController';

function buildProviderName(connection: AIConnectionSummary, model: string): string {
  return model ? `${connection.name} / ${model}` : connection.name;
}

export interface AIConnectionsController {
  connections: AIConnectionSummary[];
  providers: AIProviderSummary[];
  connectionNameInput: string;
  connectionBaseUrlInput: string;
  connectionApiKeyInput: string;
  testedConnection: AIConnectionSummary | null;
  selectedModel: string;
  providerNameInput: string;
  apiKeyPlaceholder: string;
  savedConnectionReuseActive: boolean;
  loading: boolean;
  testingProvider: boolean;
  addingProvider: boolean;
  deletingConnectionId: string | null;
  deletingProviderId: string | null;
  busy: boolean;
  status: string | null;
  updateConnectionName: (value: string) => void;
  updateConnectionBaseUrl: (value: string) => void;
  updateConnectionApiKey: (value: string) => void;
  updateProviderName: (value: string) => void;
  testConnection: () => Promise<void>;
  changeModel: (model: string) => void;
  useConnection: (connection: AIConnectionSummary) => void;
  addProvider: () => Promise<void>;
  deleteConnection: (connectionId: string) => Promise<void>;
  deleteProvider: (providerId: string) => Promise<void>;
}

export function useAIConnectionsController(
  isOpen: boolean,
  applyProxySettings: ProxySettingsController['applyProxySettings'],
): AIConnectionsController {
  const [connections, setConnections] = useState<AIConnectionSummary[]>([]);
  const [providers, setProviders] = useState<AIProviderSummary[]>([]);
  const [connectionNameInput, setConnectionNameInput] = useState('');
  const [connectionBaseUrlInput, setConnectionBaseUrlInput] = useState('');
  const [connectionApiKeyInput, setConnectionApiKeyInput] = useState('');
  const [testedConnection, setTestedConnection] = useState<AIConnectionSummary | null>(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [providerNameInput, setProviderNameInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [testingProvider, setTestingProvider] = useState(false);
  const [addingProvider, setAddingProvider] = useState(false);
  const [deletingConnectionId, setDeletingConnectionId] = useState<string | null>(null);
  const [deletingProviderId, setDeletingProviderId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const resetTestedConnection = () => {
    const hadTestedState =
      testedConnection !== null || selectedModel.length > 0 || providerNameInput.length > 0;
    if (!hadTestedState) return;

    setTestedConnection(null);
    setSelectedModel('');
    setProviderNameInput('');
    setStatus('Connection details changed. Test the connection again.');
  };

  useEffect(() => {
    if (!isOpen) return;

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
        const [connectionList, providerList] = await Promise.all([
          apiClient.listAIConnections(),
          apiClient.listAIProviders(),
        ]);

        setConnections(connectionList);
        setProviders(providerList);
      } catch {
        setConnections([]);
        setProviders([]);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [isOpen]);

  const reloadConnectionsAndProviders = async () => {
    const [connectionList, providerList] = await Promise.all([
      apiClient.listAIConnections(),
      apiClient.listAIProviders(),
    ]);
    setConnections(connectionList);
    setProviders(providerList);
  };

  const testConnection = async () => {
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
      setStatus(
        `Connection tested: ${result.connection.discoveredModels.length} models discovered.`,
      );
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

  const changeModel = (model: string) => {
    const previousModel = selectedModel;
    setSelectedModel(model);

    if (!testedConnection) return;

    const previousDefault = buildProviderName(testedConnection, previousModel);
    if (!providerNameInput.trim() || providerNameInput === previousDefault) {
      setProviderNameInput(buildProviderName(testedConnection, model));
    }
  };

  const useConnection = (connection: AIConnectionSummary) => {
    const model = chooseInitialProviderModel(connection, providers);
    setConnectionNameInput(connection.name);
    setConnectionBaseUrlInput(connection.baseUrl);
    setConnectionApiKeyInput('');
    setTestedConnection(connection);
    setSelectedModel(model);
    setProviderNameInput(buildProviderName(connection, model));
    setStatus('Saved connection selected. Stored key will be reused when adding a provider.');
  };

  const addProvider = async () => {
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

  const deleteConnection = async (connectionId: string) => {
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

  const deleteProvider = async (providerId: string) => {
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

  const savedConnectionReuseActive = isSavedConnectionReuseActive(
    testedConnection,
    connectionApiKeyInput,
  );
  const apiKeyPlaceholder = savedConnectionReuseActive
    ? testedConnection?.apiKeyLast4
      ? `Saved key ****${testedConnection.apiKeyLast4}; enter a new key to retest`
      : 'Saved key will be reused; enter a new key to retest'
    : 'sk-...';

  return {
    connections,
    providers,
    connectionNameInput,
    connectionBaseUrlInput,
    connectionApiKeyInput,
    testedConnection,
    selectedModel,
    providerNameInput,
    apiKeyPlaceholder,
    savedConnectionReuseActive,
    loading,
    testingProvider,
    addingProvider,
    deletingConnectionId,
    deletingProviderId,
    busy:
      loading ||
      testingProvider ||
      addingProvider ||
      deletingConnectionId !== null ||
      deletingProviderId !== null,
    status,
    updateConnectionName: (value) => {
      setConnectionNameInput(value);
      resetTestedConnection();
    },
    updateConnectionBaseUrl: (value) => {
      setConnectionBaseUrlInput(value);
      resetTestedConnection();
    },
    updateConnectionApiKey: (value) => {
      setConnectionApiKeyInput(value);
      resetTestedConnection();
    },
    updateProviderName: setProviderNameInput,
    testConnection,
    changeModel,
    useConnection,
    addProvider,
    deleteConnection,
    deleteProvider,
  };
}
