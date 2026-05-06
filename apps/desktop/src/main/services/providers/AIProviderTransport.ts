import { AITransport } from '../ports';

function extractMessageText(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const record = data as {
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  };

  for (const choice of record.choices ?? []) {
    const content = choice?.message?.content;
    if (typeof content === 'string' && content.trim()) {
      return content;
    }

    if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          if (!part || typeof part !== 'object') {
            return null;
          }

          const contentPart = part as {
            type?: unknown;
            text?: unknown;
          };

          if (typeof contentPart.text === 'string') {
            return contentPart.text;
          }

          return contentPart.type === 'text' && typeof contentPart.text === 'string'
            ? contentPart.text
            : null;
        })
        .filter((value): value is string => Boolean(value))
        .join('\n')
        .trim();

      if (text) {
        return text;
      }
    }
  }

  return null;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export class AIProviderTransport implements AITransport {
  private getProxyHint(): string {
    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
    return proxy ? ` (proxy=${proxy})` : '';
  }

  public async testConnection(params: {
    apiKey: string;
    baseUrl: string;
    model: string;
  }): Promise<{
    ok: true;
    status: number;
    endpoint: string;
    rawResponseText?: string;
  }> {
    const response = await this.postChatCompletions({
      ...params,
      systemPrompt: 'Return exactly OK.',
      userPrompt: 'OK',
    });

    return {
      ok: true,
      status: response.status,
      endpoint: response.endpoint,
      rawResponseText: response.rawResponseText,
    };
  }

  public async createResponse(params: {
    apiKey: string;
    baseUrl: string;
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
    return this.postChatCompletions(params);
  }

  private async postChatCompletions(params: {
    apiKey: string;
    baseUrl: string;
    model: string;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<{
    content: string;
    requestId?: string;
    status: number;
    endpoint: string;
    rawResponseText?: string;
  }> {
    const endpoint = `${normalizeBaseUrl(params.baseUrl)}/chat/completions`;
    const maxRetries = 3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let response: Response;

      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            Authorization: `Bearer ${params.apiKey}`,
          },
          body: JSON.stringify({
            model: params.model,
            messages: [
              { role: 'system', content: params.systemPrompt },
              { role: 'user', content: params.userPrompt },
            ],
          }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `AI provider network request failed: ${message}${this.getProxyHint()} endpoint=${endpoint}`,
        );
      }

      if (response.status === 429 && attempt < maxRetries) {
        const retryAfterSec = parseFloat(response.headers.get('retry-after') ?? '');
        const backoffMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? retryAfterSec * 1000
          : Math.min(1000 * 2 ** attempt, 16000);
        await sleep(backoffMs);
        continue;
      }

      const requestId =
        response.headers.get('x-request-id') ||
        response.headers.get('x-openai-request-id') ||
        undefined;
      const rawBody = await response.text();

      if (!response.ok) {
        throw new Error(`AI provider request failed: ${response.status} ${rawBody}`);
      }

      let data: unknown;
      try {
        data = JSON.parse(rawBody) as unknown;
      } catch {
        throw new Error(`AI provider response is not valid JSON: ${rawBody}`);
      }

      const content = extractMessageText(data);
      if (!content) {
        throw new Error('AI provider response missing assistant content');
      }

      return {
        content,
        requestId,
        status: response.status,
        endpoint,
        rawResponseText: rawBody.slice(0, 4000),
      };
    }

    // exhausted retries (TypeScript flow; loop always returns or throws)
    throw new Error(`AI provider request failed: exceeded ${maxRetries} retries on rate limit`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
