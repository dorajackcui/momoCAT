import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SettingsModal } from './SettingsModal';

const apiClientMock = {
  getAISettings: vi.fn(),
  getProxySettings: vi.fn(),
  listAIProviders: vi.fn(),
  setAIKey: vi.fn(),
  clearAIKey: vi.fn(),
  setProxySettings: vi.fn(),
  testAIConnection: vi.fn(),
  testAIProvider: vi.fn(),
  addAIProvider: vi.fn(),
  deleteAIProvider: vi.fn(),
};

vi.mock('../services/apiClient', () => ({
  apiClient: apiClientMock,
}));

describe('SettingsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClientMock.getAISettings.mockResolvedValue({
      apiKeySet: true,
      apiKeyLast4: '1234',
    });
    apiClientMock.getProxySettings.mockResolvedValue({
      mode: 'system',
      customProxyUrl: '',
      effectiveProxyUrl: '',
    });
    apiClientMock.listAIProviders.mockResolvedValue([
      {
        id: 'builtin:openai:gpt-5.4-mini',
        name: 'OpenAI / gpt-5.4-mini',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.4-mini',
        protocol: 'chat-completions',
        kind: 'builtin',
        apiKeyLast4: '1234',
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: '1970-01-01T00:00:00.000Z',
      },
    ]);
    apiClientMock.setProxySettings.mockResolvedValue({
      mode: 'system',
      customProxyUrl: '',
      effectiveProxyUrl: '',
    });
    apiClientMock.testAIProvider.mockResolvedValue({
      ok: true,
      endpoint: 'https://example.com/v1/chat/completions',
      model: 'gpt-demo',
    });
    apiClientMock.addAIProvider.mockResolvedValue({
      id: 'custom:demo',
      name: 'Demo Provider',
      baseUrl: 'https://example.com/v1',
      model: 'gpt-demo',
      protocol: 'chat-completions',
      kind: 'custom',
      apiKeyLast4: '9999',
      createdAt: '2026-03-30T00:00:00.000Z',
      updatedAt: '2026-03-30T00:00:00.000Z',
    });
    apiClientMock.deleteAIProvider.mockResolvedValue(undefined);
  });

  it('defaults to the OpenAI tab and switches tabs without losing form input', async () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />);

    await screen.findByText('OpenAI API Key');
    expect(screen.queryByText('Custom AI Providers')).not.toBeInTheDocument();
    expect(screen.queryByText('Proxy Settings')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Custom Providers' }));
    await screen.findByText('Custom AI Providers');

    fireEvent.change(screen.getByLabelText('Provider Name'), {
      target: { value: 'Sticky Provider' },
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Proxy' }));
    await screen.findByText('Proxy Settings');

    fireEvent.click(screen.getByRole('tab', { name: 'Custom Providers' }));
    expect(screen.getByLabelText('Provider Name')).toHaveValue('Sticky Provider');
  });

  it('requires a successful provider test before allowing add', async () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Custom Providers' }));
    await screen.findByText('Custom AI Providers');

    fireEvent.change(screen.getByLabelText('Provider Name'), {
      target: { value: 'Demo Provider' },
    });
    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'gpt-demo' },
    });
    fireEvent.change(screen.getByLabelText('API Base URL'), {
      target: { value: 'https://example.com/v1' },
    });
    fireEvent.change(screen.getByLabelText('API Key'), {
      target: { value: 'secret-9999' },
    });

    expect(screen.getByText('Add Provider')).toBeDisabled();

    fireEvent.click(screen.getByText('Test Provider'));

    await waitFor(() =>
      expect(apiClientMock.testAIProvider).toHaveBeenCalledWith({
        name: 'Demo Provider',
        baseUrl: 'https://example.com/v1',
        apiKey: 'secret-9999',
        model: 'gpt-demo',
      }),
    );

    await waitFor(() => expect(screen.getByText('Add Provider')).not.toBeDisabled());

    fireEvent.click(screen.getByText('Add Provider'));

    await waitFor(() =>
      expect(apiClientMock.addAIProvider).toHaveBeenCalledWith({
        name: 'Demo Provider',
        baseUrl: 'https://example.com/v1',
        apiKey: 'secret-9999',
        model: 'gpt-demo',
      }),
    );
  });

  it('deletes custom providers and keeps builtin providers locked', async () => {
    apiClientMock.listAIProviders.mockResolvedValue([
      {
        id: 'builtin:openai:gpt-5.4-mini',
        name: 'OpenAI / gpt-5.4-mini',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.4-mini',
        protocol: 'chat-completions',
        kind: 'builtin',
        apiKeyLast4: '1234',
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: '1970-01-01T00:00:00.000Z',
      },
      {
        id: 'custom:demo',
        name: 'Demo Provider',
        baseUrl: 'https://example.com/v1',
        model: 'gpt-demo',
        protocol: 'chat-completions',
        kind: 'custom',
        apiKeyLast4: '9999',
        createdAt: '2026-03-30T00:00:00.000Z',
        updatedAt: '2026-03-30T00:00:00.000Z',
      },
    ]);

    render(<SettingsModal isOpen onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Custom Providers' }));
    await screen.findByText('Demo Provider');

    expect(screen.getByText('Built-in')).toBeDisabled();

    fireEvent.click(screen.getByText('Delete'));

    await waitFor(() => expect(apiClientMock.deleteAIProvider).toHaveBeenCalledWith('custom:demo'));
  });

  it('saves proxy settings from the proxy tab and keeps status visible', async () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Proxy' }));
    await screen.findByText('Proxy Settings');

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
});
