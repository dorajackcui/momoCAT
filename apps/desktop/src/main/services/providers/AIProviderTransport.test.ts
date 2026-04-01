import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIProviderTransport } from './AIProviderTransport';

describe('AIProviderTransport', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
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

  it('throws helpful errors for non-json responses', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('not-json', { status: 200 })) as typeof fetch;

    const transport = new AIProviderTransport();

    await expect(
      transport.createResponse({
        apiKey: 'secret',
        baseUrl: 'https://example.com/v1',
        model: 'gpt-demo',
        reasoningEffort: 'medium',
        systemPrompt: 'system',
        userPrompt: 'user',
      }),
    ).rejects.toThrow(/not valid json/i);
  });

  it('surfaces provider request failures', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('bad request', { status: 400 })) as typeof fetch;

    const transport = new AIProviderTransport();

    await expect(
      transport.testConnection({
        apiKey: 'secret',
        baseUrl: 'https://example.com/v1',
        model: 'gpt-demo',
      }),
    ).rejects.toThrow(/400 bad request/i);
  });
});
