import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIProviderTransport } from './AIProviderTransport';

async function captureError(action: () => Promise<unknown>): Promise<Error> {
  try {
    await action();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }

  throw new Error('Expected action to throw');
}

function restoreEnvValue(key: 'HTTPS_PROXY' | 'HTTP_PROXY' | 'ALL_PROXY', value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

describe('AIProviderTransport', () => {
  const originalFetch = global.fetch;
  const originalHttpsProxy = process.env.HTTPS_PROXY;
  const originalHttpProxy = process.env.HTTP_PROXY;
  const originalAllProxy = process.env.ALL_PROXY;

  afterEach(() => {
    global.fetch = originalFetch;
    restoreEnvValue('HTTPS_PROXY', originalHttpsProxy);
    restoreEnvValue('HTTP_PROXY', originalHttpProxy);
    restoreEnvValue('ALL_PROXY', originalAllProxy);
    vi.restoreAllMocks();
  });

  it('parses assistant content from chat completions responses', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'Translated text',
              },
            },
          ],
        }),
        { status: 200 },
      ),
    ) as typeof fetch;

    const transport = new AIProviderTransport();
    const response = await transport.createResponse({
      apiKey: 'secret',
      baseUrl: 'https://example.com/v1/',
      model: 'gpt-demo',
      reasoningEffort: 'medium',
      systemPrompt: 'system',
      userPrompt: 'user',
    });

    expect(response.content).toBe('Translated text');
    expect(response.endpoint).toBe('https://example.com/v1/chat/completions');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: 'Bearer secret',
        },
        body: JSON.stringify({
          model: 'gpt-demo',
          messages: [
            { role: 'system', content: 'system' },
            { role: 'user', content: 'user' },
          ],
        }),
      }),
    );
  });

  it('redacts proxy and endpoint credentials from network errors', async () => {
    process.env.HTTPS_PROXY = 'https://proxy-user:proxy-secret@proxy.example.test:8443';
    process.env.HTTP_PROXY = '';
    process.env.ALL_PROXY = '';
    global.fetch = vi.fn().mockRejectedValue(new Error('socket failed')) as typeof fetch;

    const transport = new AIProviderTransport();

    const error = await captureError(() =>
      transport.createResponse({
        apiKey: 'secret',
        baseUrl: 'https://provider-user:provider-secret@example.com/v1',
        model: 'gpt-demo',
        reasoningEffort: 'medium',
        systemPrompt: 'system',
        userPrompt: 'user',
      }),
    );

    expect(error.message).toMatch(/proxy configured/i);
    expect(error.message).not.toMatch(/proxy-secret|provider-secret|provider-user/i);
  });

  it('sanitizes provider failure bodies in errors', async () => {
    const sensitiveBody = `bad request token=secret-token ${'x'.repeat(1000)}`;
    global.fetch = vi.fn().mockResolvedValue(new Response(sensitiveBody, { status: 400 })) as typeof fetch;

    const transport = new AIProviderTransport();

    const error = await captureError(() =>
      transport.testConnection({
        apiKey: 'secret',
        baseUrl: 'https://example.com/v1',
        model: 'gpt-demo',
      }),
    );

    expect(error.message).toMatch(/400/);
    expect(error.message).not.toMatch(/secret-token|x{300}/);
  });

  it('sanitizes invalid json bodies in errors', async () => {
    const sensitiveBody = `not-json api_key=secret-token ${'y'.repeat(1000)}`;
    global.fetch = vi.fn().mockResolvedValue(new Response(sensitiveBody, { status: 200 })) as typeof fetch;

    const transport = new AIProviderTransport();

    const error = await captureError(() =>
      transport.createResponse({
        apiKey: 'secret',
        baseUrl: 'https://example.com/v1',
        model: 'gpt-demo',
        reasoningEffort: 'medium',
        systemPrompt: 'system',
        userPrompt: 'user',
      }),
    );

    expect(error.message).toMatch(/not valid json/i);
    expect(error.message).not.toMatch(/secret-token|y{300}/);
  });

  it('redacts json-style secrets in provider errors', async () => {
    const sensitiveBody = JSON.stringify({
      error: {
        message: 'request failed',
        api_key: 'sk-json-secret',
        token: 'json-token-secret',
      },
    });
    global.fetch = vi.fn().mockResolvedValue(new Response(sensitiveBody, { status: 400 })) as typeof fetch;

    const transport = new AIProviderTransport();

    const error = await captureError(() =>
      transport.testConnection({
        apiKey: 'secret',
        baseUrl: 'https://example.com/v1',
        model: 'gpt-demo',
      }),
    );

    expect(error.message).toMatch(/request failed/);
    expect(error.message).not.toMatch(/sk-json-secret|json-token-secret/);
  });

  it('redacts header-style secrets in provider errors', async () => {
    const sensitiveBody = [
      'api-key: sk-header-secret',
      'Authorization: Bearer bearer-secret',
      'Authorization: Basic basic-secret',
      'token: header-token-secret',
    ].join('\n');
    global.fetch = vi.fn().mockResolvedValue(new Response(sensitiveBody, { status: 400 })) as typeof fetch;

    const transport = new AIProviderTransport();

    const error = await captureError(() =>
      transport.testConnection({
        apiKey: 'secret',
        baseUrl: 'https://example.com/v1',
        model: 'gpt-demo',
      }),
    );

    expect(error.message).not.toMatch(/sk-header-secret|bearer-secret|basic-secret|header-token-secret/);
  });
});
