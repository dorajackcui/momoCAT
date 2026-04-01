import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_PROMPT_DEBUG_ENV,
  AI_PROMPT_DEBUG_FILE_ENV,
  isAIPromptDebugEnabled,
  logAIPromptDebug,
} from './promptDebug';

describe('promptDebug', () => {
  afterEach(() => {
    delete process.env[AI_PROMPT_DEBUG_ENV];
    delete process.env[AI_PROMPT_DEBUG_FILE_ENV];
    vi.restoreAllMocks();
  });

  it('treats common truthy values as enabled', () => {
    process.env[AI_PROMPT_DEBUG_ENV] = 'true';
    expect(isAIPromptDebugEnabled()).toBe(true);

    process.env[AI_PROMPT_DEBUG_ENV] = '1';
    expect(isAIPromptDebugEnabled()).toBe(true);
  });

  it('logs prompts only when enabled', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    logAIPromptDebug({
      flow: 'segment',
      model: 'gpt-5.4-mini',
      reasoningEffort: 'medium',
      systemPrompt: 'system',
      userPrompt: 'user',
      attempt: 1,
      segmentId: 'seg-1',
    });
    expect(logSpy).not.toHaveBeenCalled();

    process.env[AI_PROMPT_DEBUG_ENV] = 'on';
    logAIPromptDebug({
      flow: 'dialogue',
      model: 'gpt-5.4-mini',
      systemPrompt: 'system prompt body',
      userPrompt: 'user prompt body',
      attempt: 2,
      segmentIds: ['seg-1', 'seg-2'],
    });

    expect(logSpy).toHaveBeenCalledTimes(3);
    expect(logSpy).toHaveBeenNthCalledWith(
      1,
      '[AIPromptDebug] flow=dialogue model=gpt-5.4-mini attempt=2 segmentIds=seg-1,seg-2',
    );
    expect(logSpy).toHaveBeenNthCalledWith(
      2,
      '[AIPromptDebug][systemPrompt]\nsystem prompt body',
    );
    expect(logSpy).toHaveBeenNthCalledWith(
      3,
      '[AIPromptDebug][userPrompt]\nuser prompt body',
    );
  });

  it('appends prompts to a UTF-8 debug file when configured', async () => {
    const root = mkdtempSync(join(tmpdir(), 'prompt-debug-'));
    const debugFilePath = join(root, 'ai_prompt_debug.log');

    try {
      process.env[AI_PROMPT_DEBUG_ENV] = '1';
      process.env[AI_PROMPT_DEBUG_FILE_ENV] = debugFilePath;

      logAIPromptDebug({
        flow: 'segment',
        model: 'gpt-5.4-mini',
        systemPrompt: '系统提示：示例调试内容',
        userPrompt: '用户提示：示例输入内容',
        attempt: 1,
        segmentId: 'seg-7',
      });

      let content = '';
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        try {
          content = readFileSync(debugFilePath, 'utf8');
        } catch {
          content = '';
        }

        if (content.includes('flow=segment model=gpt-5.4-mini attempt=1 segmentId=seg-7')) {
          break;
        }
      }

      expect(content).toContain('flow=segment model=gpt-5.4-mini attempt=1 segmentId=seg-7');
      expect(content).toContain('系统提示：示例调试内容');
      expect(content).toContain('用户提示：示例输入内容');
    } finally {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      rmSync(root, { recursive: true, force: true });
    }
  });
});
