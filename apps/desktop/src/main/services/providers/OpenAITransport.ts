import { AITransport } from '../ports';

function extractResponseText(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const record = data as {
    output_text?: unknown;
    output?: Array<{
      type?: unknown;
      content?: Array<{
        type?: unknown;
        text?: unknown;
      }>;
    }>;
  };

  if (typeof record.output_text === 'string' && record.output_text.trim()) {
    return record.output_text;
  }

  for (const item of record.output ?? []) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) {
      continue;
    }

    const textParts = item.content
      .filter(
        (part): part is { type: 'output_text'; text: string } =>
          part?.type === 'output_text' && typeof part.text === 'string',
      )
      .map((part) => part.text);

    if (textParts.length > 0) {
      return textParts.join('\n');
    }
  }

  return null;
}

export class OpenAITransport implements AITransport {
  private getProxyHint(): string {
    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
    return proxy ? ` (proxy=${proxy})` : '';
  }

  public async testConnection(apiKey: string): Promise<{ ok: true }> {
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`OpenAI network request failed: ${message}${this.getProxyHint()}`);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Connection failed: ${response.status} ${errorText}`);
    }

    return { ok: true };
  }

  public async createResponse(params: {
    apiKey: string;
    model: string;
    reasoningEffort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    systemPrompt: string;
    userPrompt: string;
  }): Promise<{
    content: string;
    requestId?: string;
    status: number;
    endpoint: string;
    rawResponseText?: string;
  }> {
    const endpoint = 'https://api.openai.com/v1/responses';
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify({
          model: params.model,
          reasoning: {
            effort: params.reasoningEffort,
          },
          text: {
            format: {
              type: 'text',
            },
          },
          input: [
            {
              role: 'system',
              content: [{ type: 'input_text', text: params.systemPrompt }],
            },
            {
              role: 'user',
              content: [{ type: 'input_text', text: params.userPrompt }],
            },
          ],
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `OpenAI network request failed: ${message}${this.getProxyHint()} endpoint=${endpoint}`,
      );
    }

    const requestId =
      response.headers.get('x-request-id') ||
      response.headers.get('x-openai-request-id') ||
      undefined;
    const rawBody = await response.text();

    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${response.status} ${rawBody}`);
    }

    let data: unknown;
    try {
      data = JSON.parse(rawBody) as unknown;
    } catch {
      throw new Error(`OpenAI response is not valid JSON: ${rawBody}`);
    }

    const content = extractResponseText(data);
    if (!content || typeof content !== 'string') {
      throw new Error('OpenAI response missing content');
    }

    return {
      content,
      requestId,
      status: response.status,
      endpoint,
      rawResponseText: rawBody.slice(0, 4000),
    };
  }
}
