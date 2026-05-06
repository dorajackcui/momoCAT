import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_BATCH_DEBUG_ENV,
  AI_BATCH_DEBUG_FILE_ENV,
  isAIBatchDebugEnabled,
  logAIBatchDebug,
} from './aiBatchDebug';

describe('aiBatchDebug', () => {
  afterEach(() => {
    delete process.env[AI_BATCH_DEBUG_ENV];
    delete process.env[AI_BATCH_DEBUG_FILE_ENV];
    vi.restoreAllMocks();
  });

  it('logs only when batch debug is enabled', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    logAIBatchDebug({ event: 'segment_start', fileId: 1, segmentId: 'seg-1' });
    expect(logSpy).not.toHaveBeenCalled();

    process.env[AI_BATCH_DEBUG_ENV] = '1';
    expect(isAIBatchDebugEnabled()).toBe(true);

    logAIBatchDebug({
      event: 'segment_failed',
      fileId: 1,
      segmentId: 'seg-1',
      stage: 'translate',
      error: 'provider failed',
    });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[AIBatchDebug] event=segment_failed fileId=1 segmentId=seg-1 stage=translate',
      ),
    );
  });

  it('appends JSON lines to the configured debug file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'batch-debug-'));
    const debugFilePath = join(root, 'ai_batch_translate_debug.log');

    try {
      process.env[AI_BATCH_DEBUG_ENV] = '1';
      process.env[AI_BATCH_DEBUG_FILE_ENV] = debugFilePath;
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      logAIBatchDebug({
        event: 'segment_write_success',
        fileId: 2,
        projectId: 11,
        segmentId: 'seg-2',
        orderIndex: 7,
        targetChars: 12,
      });

      let content = '';
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        try {
          content = readFileSync(debugFilePath, 'utf8');
        } catch {
          content = '';
        }

        if (content.includes('"event":"segment_write_success"')) {
          break;
        }
      }

      const entry = JSON.parse(content.trim());
      expect(entry).toMatchObject({
        event: 'segment_write_success',
        fileId: 2,
        projectId: 11,
        segmentId: 'seg-2',
        orderIndex: 7,
        targetChars: 12,
      });
      expect(entry.ts).toEqual(expect.any(String));
    } finally {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      rmSync(root, { recursive: true, force: true });
    }
  });
});
