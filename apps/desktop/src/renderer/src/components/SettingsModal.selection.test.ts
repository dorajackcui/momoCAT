import { describe, expect, it } from 'vitest';
import type { AIConnectionSummary, AIProviderSummary } from '../../../shared/ipc';
import {
  chooseInitialProviderModel,
  isSavedConnectionReuseActive,
} from './aiProviderSelection';

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

describe('chooseInitialProviderModel', () => {
  it('prefers a discovered model that is not already configured on the saved connection', () => {
    expect(chooseInitialProviderModel(connection, [provider])).toBe('gpt-demo-mini');
  });

  it('falls back to the first discovered model when all saved connection models are configured', () => {
    expect(
      chooseInitialProviderModel(connection, [
        provider,
        {
          ...provider,
          id: 'provider:gpt-demo-mini',
          name: 'OpenAI / gpt-demo-mini',
          model: 'gpt-demo-mini',
        },
      ]),
    ).toBe('gpt-demo');
  });
});

describe('isSavedConnectionReuseActive', () => {
  it('treats a selected saved connection with an empty API key input as stored-key reuse', () => {
    expect(isSavedConnectionReuseActive(connection, '')).toBe(true);
    expect(isSavedConnectionReuseActive(connection, '   ')).toBe(true);
  });

  it('does not treat normal connection testing as stored-key reuse', () => {
    expect(isSavedConnectionReuseActive(null, '')).toBe(false);
    expect(isSavedConnectionReuseActive(connection, 'sk-test-1234')).toBe(false);
  });
});
