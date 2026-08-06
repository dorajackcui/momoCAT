// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsModal } from './SettingsModal';
import type {
  AIConnectionSummary,
  AIProviderSummary,
  SourceTerminologyPromptSettings,
  SourceTerminologyPromptSettingsInput,
} from '../../../shared/ipc';

const connection: AIConnectionSummary = {
  id: 'connection:openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  protocol: 'chat-completions',
  kind: 'openai-compatible',
  apiKeyLast4: '1234',
  discoveredModels: ['gpt-demo', 'gpt-demo-mini'],
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
};

const provider: AIProviderSummary = {
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

const legacyProvider: AIProviderSummary = {
  ...provider,
  id: 'legacy:old-provider',
  name: 'Legacy Provider',
  kind: 'legacy',
  connectionId: '',
  connectionName: 'Legacy',
};

const defaultPromptSettings: SourceTerminologyPromptSettings = {
  prompt: 'Default extraction rules.',
  activePromptId: 'builtin:default',
  prompts: [
    {
      id: 'builtin:default',
      name: 'Default',
      prompt: 'Default extraction rules.',
      isBuiltin: true,
    },
  ],
  maxChars: 12000,
  maxNameChars: 80,
};

const apiClientMock = vi.hoisted(() => ({
  getProxySettings: vi.fn(),
  setProxySettings: vi.fn(),
  getSourceTerminologyPromptSettings: vi.fn(),
  setSourceTerminologyPromptSettings: vi.fn(),
  listAIConnections: vi.fn(),
  testAIConnection: vi.fn(),
  deleteAIConnection: vi.fn(),
  listAIProviders: vi.fn(),
  addAIProvider: vi.fn(),
  deleteAIProvider: vi.fn(),
}));

vi.mock('../services/apiClient', () => ({
  apiClient: apiClientMock,
}));

async function waitForConnectionsTabReady() {
  await screen.findByRole('heading', { name: 'AI Connections' });
  await waitFor(() => expect(screen.getByText('Test Connection')).not.toBeDisabled());
}

describe('SettingsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClientMock.getProxySettings.mockResolvedValue({
      mode: 'system',
      customProxyUrl: '',
      effectiveProxyUrl: '',
    });
    apiClientMock.setProxySettings.mockResolvedValue({
      mode: 'system',
      customProxyUrl: '',
      effectiveProxyUrl: '',
    });
    apiClientMock.getSourceTerminologyPromptSettings.mockResolvedValue(defaultPromptSettings);
    apiClientMock.setSourceTerminologyPromptSettings.mockImplementation(
      async (input: SourceTerminologyPromptSettingsInput) => {
        if (input.action === 'create') {
          return {
            ...defaultPromptSettings,
            prompt: input.prompt,
            activePromptId: 'prompt-1',
            prompts: [
              ...defaultPromptSettings.prompts,
              {
                id: 'prompt-1',
                name: input.name,
                prompt: input.prompt,
                isBuiltin: false,
              },
            ],
          };
        }
        return defaultPromptSettings;
      },
    );
    apiClientMock.listAIConnections.mockResolvedValue([]);
    apiClientMock.testAIConnection.mockResolvedValue({
      ok: true,
      connection,
      models: connection.discoveredModels,
      endpoint: 'https://api.openai.com/v1/models',
    });
    apiClientMock.deleteAIConnection.mockResolvedValue(undefined);
    apiClientMock.listAIProviders.mockResolvedValue([]);
    apiClientMock.addAIProvider.mockResolvedValue(provider);
    apiClientMock.deleteAIProvider.mockResolvedValue(undefined);
  });

  it('tests a connection, shows discovered models, and creates a provider from the selected model', async () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />);

    await waitForConnectionsTabReady();

    fireEvent.change(screen.getByLabelText('Connection Name'), {
      target: { value: 'OpenAI' },
    });
    fireEvent.change(screen.getByLabelText('API Base URL'), {
      target: { value: 'https://api.openai.com/v1' },
    });
    fireEvent.change(screen.getByLabelText('API Key'), {
      target: { value: 'sk-test-1234' },
    });

    fireEvent.click(screen.getByText('Test Connection'));

    await waitFor(() =>
      expect(apiClientMock.testAIConnection).toHaveBeenCalledWith({
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test-1234',
      }),
    );

    expect(await screen.findByText('Connection tested: 2 models discovered.')).toBeInTheDocument();
    expect(screen.getByLabelText('Model')).toHaveValue('gpt-demo');
    expect(screen.getByLabelText('Provider Name')).toHaveValue('OpenAI / gpt-demo');

    fireEvent.click(screen.getByText('Add Provider'));

    await waitFor(() =>
      expect(apiClientMock.addAIProvider).toHaveBeenCalledWith({
        name: 'OpenAI / gpt-demo',
        connectionId: 'connection:openai',
        model: 'gpt-demo',
      }),
    );
  });

  it('invalidates the tested connection when connection inputs change', async () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />);

    await waitForConnectionsTabReady();

    fireEvent.change(screen.getByLabelText('Connection Name'), {
      target: { value: 'OpenAI' },
    });
    fireEvent.change(screen.getByLabelText('API Base URL'), {
      target: { value: 'https://api.openai.com/v1' },
    });
    fireEvent.change(screen.getByLabelText('API Key'), {
      target: { value: 'sk-test-1234' },
    });

    fireEvent.click(screen.getByText('Test Connection'));

    expect(await screen.findByText('Connection tested: 2 models discovered.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Add Provider')).not.toBeDisabled());

    fireEvent.change(screen.getByLabelText('API Base URL'), {
      target: { value: 'https://example.com/v1' },
    });

    expect(screen.getByLabelText('Model')).toHaveValue('');
    expect(screen.getByText('Add Provider')).toBeDisabled();

    fireEvent.click(screen.getByText('Add Provider'));

    expect(apiClientMock.addAIProvider).not.toHaveBeenCalled();
  });

  it('applies the current proxy draft before testing a connection', async () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Proxy' }));
    await waitFor(() => expect(screen.getByText('Save Proxy Settings')).not.toBeDisabled());
    fireEvent.click(screen.getByLabelText('Use Custom Proxy URL'));
    fireEvent.change(screen.getByLabelText('Custom Proxy URL'), {
      target: { value: 'http://127.0.0.1:7890' },
    });

    fireEvent.click(screen.getByRole('tab', { name: 'AI Connections' }));
    await waitForConnectionsTabReady();
    fireEvent.change(screen.getByLabelText('Connection Name'), {
      target: { value: 'OpenAI' },
    });
    fireEvent.change(screen.getByLabelText('API Base URL'), {
      target: { value: 'https://api.openai.com/v1' },
    });
    fireEvent.change(screen.getByLabelText('API Key'), {
      target: { value: 'sk-test-1234' },
    });
    apiClientMock.setProxySettings.mockResolvedValueOnce({
      mode: 'custom',
      customProxyUrl: 'http://127.0.0.1:7890',
      effectiveProxyUrl: 'http://127.0.0.1:7890',
    });

    fireEvent.click(screen.getByText('Test Connection'));

    await waitFor(() =>
      expect(apiClientMock.setProxySettings).toHaveBeenCalledWith({
        mode: 'custom',
        customProxyUrl: 'http://127.0.0.1:7890',
      }),
    );
    expect(apiClientMock.setProxySettings.mock.invocationCallOrder[0]).toBeLessThan(
      apiClientMock.testAIConnection.mock.invocationCallOrder[0],
    );
  });

  it('keeps proxy save disabled and clears stale proxy status during a connection test', async () => {
    const testResult = {
      ok: true,
      connection,
      models: connection.discoveredModels,
      endpoint: 'https://api.openai.com/v1/models',
    };
    let resolveConnectionTest: (result: typeof testResult) => void = () => undefined;
    apiClientMock.testAIConnection.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConnectionTest = resolve;
        }),
    );
    render(<SettingsModal isOpen onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Proxy' }));
    await waitFor(() => expect(screen.getByText('Save Proxy Settings')).not.toBeDisabled());
    fireEvent.click(screen.getByLabelText('Use Custom Proxy URL'));
    fireEvent.change(screen.getByLabelText('Custom Proxy URL'), {
      target: { value: 'http://127.0.0.1:7001' },
    });
    apiClientMock.setProxySettings.mockResolvedValueOnce({
      mode: 'custom',
      customProxyUrl: 'http://127.0.0.1:7001',
      effectiveProxyUrl: 'http://127.0.0.1:7001',
    });
    fireEvent.click(screen.getByText('Save Proxy Settings'));
    expect(await screen.findByText('Proxy applied: http://127.0.0.1:7001')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Custom Proxy URL'), {
      target: { value: 'http://127.0.0.1:7002' },
    });
    apiClientMock.setProxySettings.mockResolvedValueOnce({
      mode: 'custom',
      customProxyUrl: 'http://127.0.0.1:7002',
      effectiveProxyUrl: 'http://127.0.0.1:7002',
    });
    fireEvent.click(screen.getByRole('tab', { name: 'AI Connections' }));
    await waitForConnectionsTabReady();
    fireEvent.change(screen.getByLabelText('Connection Name'), {
      target: { value: 'OpenAI' },
    });
    fireEvent.change(screen.getByLabelText('API Base URL'), {
      target: { value: 'https://api.openai.com/v1' },
    });
    fireEvent.change(screen.getByLabelText('API Key'), {
      target: { value: 'sk-test-1234' },
    });
    fireEvent.click(screen.getByText('Test Connection'));
    await waitFor(() => expect(apiClientMock.testAIConnection).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('tab', { name: 'Proxy' }));
    expect(screen.getByText('Save Proxy Settings')).toBeDisabled();
    expect(screen.getByText('Active proxy: http://127.0.0.1:7002')).toBeInTheDocument();
    expect(screen.queryByText('Proxy applied: http://127.0.0.1:7001')).not.toBeInTheDocument();

    resolveConnectionTest(testResult);
    await waitFor(() => expect(screen.getByText('Save Proxy Settings')).not.toBeDisabled());
    expect(screen.queryByText('Connection tested: 2 models discovered.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'AI Connections' }));
    expect(await screen.findByText('Connection tested: 2 models discovered.')).toBeInTheDocument();
  });

  it('keeps discovered models available when refreshing lists after a successful test fails', async () => {
    apiClientMock.listAIConnections
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('reload failed'))
      .mockResolvedValue([]);
    apiClientMock.listAIProviders
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('reload failed'))
      .mockResolvedValue([]);

    render(<SettingsModal isOpen onClose={vi.fn()} />);

    await waitForConnectionsTabReady();

    fireEvent.change(screen.getByLabelText('Connection Name'), {
      target: { value: 'OpenAI' },
    });
    fireEvent.change(screen.getByLabelText('API Base URL'), {
      target: { value: 'https://api.openai.com/v1' },
    });
    fireEvent.change(screen.getByLabelText('API Key'), {
      target: { value: 'sk-test-1234' },
    });

    fireEvent.click(screen.getByText('Test Connection'));

    expect(await screen.findByText('Connection tested: 2 models discovered.')).toBeInTheDocument();
    expect(screen.getByLabelText('Model')).toHaveValue('gpt-demo');
    await waitFor(() => expect(screen.getByText('Add Provider')).not.toBeDisabled());

    fireEvent.click(screen.getByText('Add Provider'));

    await waitFor(() =>
      expect(apiClientMock.addAIProvider).toHaveBeenCalledWith({
        name: 'OpenAI / gpt-demo',
        connectionId: 'connection:openai',
        model: 'gpt-demo',
      }),
    );
  });

  it('lists configured and legacy providers without builtin lock controls', async () => {
    apiClientMock.listAIProviders.mockResolvedValue([provider, legacyProvider]);

    render(<SettingsModal isOpen onClose={vi.fn()} />);

    await screen.findByText('OpenAI / gpt-demo');
    expect(screen.getByText('Legacy Provider')).toBeInTheDocument();
    expect(screen.queryByText('Built-in')).not.toBeInTheDocument();
    expect(screen.getAllByText('Delete Provider')).toHaveLength(1);
    expect(screen.getByText('Read only')).toBeInTheDocument();
  });

  it('creates a provider from another model on a saved connection without retesting credentials', async () => {
    apiClientMock.listAIConnections.mockResolvedValue([connection]);
    apiClientMock.listAIProviders.mockResolvedValue([provider]);
    apiClientMock.addAIProvider.mockResolvedValue({
      ...provider,
      id: 'provider:gpt-demo-mini',
      name: 'OpenAI / gpt-demo-mini',
      model: 'gpt-demo-mini',
    });

    render(<SettingsModal isOpen onClose={vi.fn()} />);

    await screen.findByText('https://api.openai.com/v1');

    fireEvent.click(screen.getByRole('button', { name: 'Use Connection' }));

    expect(screen.getByLabelText('Model')).toHaveValue('gpt-demo-mini');
    expect(screen.getByLabelText('Provider Name')).toHaveValue('OpenAI / gpt-demo-mini');
    expect(screen.getByRole('button', { name: 'Enter Key to Retest' })).toBeDisabled();
    expect(apiClientMock.testAIConnection).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Add Provider'));

    await waitFor(() =>
      expect(apiClientMock.addAIProvider).toHaveBeenCalledWith({
        name: 'OpenAI / gpt-demo-mini',
        connectionId: 'connection:openai',
        model: 'gpt-demo-mini',
      }),
    );
  });

  it('deletes connections and providers from their rows', async () => {
    apiClientMock.listAIConnections.mockResolvedValue([connection]);
    apiClientMock.listAIProviders.mockResolvedValue([provider]);

    render(<SettingsModal isOpen onClose={vi.fn()} />);

    await screen.findByText('https://api.openai.com/v1');
    expect(screen.getByText('API Key: ****1234')).toBeInTheDocument();
    expect(screen.getByText('2 models')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Delete Connection'));

    await waitFor(() =>
      expect(apiClientMock.deleteAIConnection).toHaveBeenCalledWith('connection:openai'),
    );

    fireEvent.click(screen.getByText('Delete Provider'));

    await waitFor(() =>
      expect(apiClientMock.deleteAIProvider).toHaveBeenCalledWith('provider:gpt-demo'),
    );
  });

  it('saves proxy settings from the proxy tab and keeps status visible', async () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Proxy' }));
    await screen.findByText('Proxy Settings');
    await waitFor(() => expect(screen.getByText('Save Proxy Settings')).not.toBeDisabled());

    fireEvent.click(screen.getByLabelText('Use Custom Proxy URL'));
    fireEvent.change(screen.getByLabelText('Custom Proxy URL'), {
      target: { value: 'http://127.0.0.1:7890' },
    });
    apiClientMock.setProxySettings.mockResolvedValueOnce({
      mode: 'custom',
      customProxyUrl: 'http://127.0.0.1:7890',
      effectiveProxyUrl: 'http://127.0.0.1:7890',
    });

    fireEvent.click(screen.getByText('Save Proxy Settings'));

    await waitFor(() =>
      expect(apiClientMock.setProxySettings).toHaveBeenCalledWith({
        mode: 'custom',
        customProxyUrl: 'http://127.0.0.1:7890',
      }),
    );

    await screen.findByText('Proxy applied: http://127.0.0.1:7890');
  });

  it('creates a named term extraction prompt and switches back to the built-in default', async () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Term Extraction' }));
    const editor = await screen.findByLabelText('Term extraction selection prompt');
    expect(editor).toHaveValue('Default extraction rules.');
    expect(editor).toHaveAttribute('readonly');

    fireEvent.click(screen.getByRole('button', { name: 'New Prompt' }));
    fireEvent.change(await screen.findByLabelText('Prompt Name'), {
      target: { value: 'Named locations' },
    });
    fireEvent.change(editor, { target: { value: 'Prefer named locations.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and Use' }));

    await waitFor(() =>
      expect(apiClientMock.setSourceTerminologyPromptSettings).toHaveBeenCalledWith({
        action: 'create',
        name: 'Named locations',
        prompt: 'Prefer named locations.',
      }),
    );
    expect(
      await screen.findByText('"Named locations" was saved and is now in use.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use Default' }));

    await waitFor(() =>
      expect(apiClientMock.setSourceTerminologyPromptSettings).toHaveBeenLastCalledWith({
        action: 'activate',
        promptId: 'builtin:default',
      }),
    );
    expect(editor).toHaveValue('Default extraction rules.');
  });
});
