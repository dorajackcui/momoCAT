import { describe, expect, it, vi } from 'vitest';
import type { SegmentStatus, Token } from '@cat/core/models';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { registerProjectHandlers } from './projectHandlers';
import type { IpcMainListener } from './types';

function setup() {
  const handlers = new Map<string, IpcMainListener>();
  const result = { fileId: 1, propagatedIds: [], clientRequestId: 'request-1' };
  const updateSegment = vi.fn().mockResolvedValue(result);
  const updateSelectedSegments = vi.fn().mockResolvedValue([]);
  registerProjectHandlers({
    ipcMain: {
      handle: (channel, handler) => {
        handlers.set(channel, handler);
      },
    },
    projectService: { updateSegment, updateSelectedSegments } as never,
  });
  return {
    invoke: (...args: unknown[]) => handlers.get(IPC_CHANNELS.segment.update)!({}, ...args),
    updateSegment,
    updateSelectedSegments,
    invokeSelected: (...args: unknown[]) =>
      handlers.get(IPC_CHANNELS.segment.updateSelected)!({}, ...args),
    result,
  };
}

describe('segment update handler', () => {
  const tokens: Token[] = [{ type: 'text', content: 'Translation' }];

  it.each([
    ['missing segment ID', undefined, tokens, 'draft', undefined],
    ['blank segment ID', '  ', tokens, 'draft', undefined],
    ['numeric segment ID', 1, tokens, 'draft', undefined],
    ['missing tokens', 'seg-1', undefined, 'draft', undefined],
    ['sparse tokens', 'seg-1', new Array(1), 'draft', undefined],
    ['object tokens', 'seg-1', { type: 'text', content: 'Translation' }, 'draft', undefined],
    ['null token', 'seg-1', [null], 'draft', undefined],
    ['non-string content', 'seg-1', [{ type: 'text', content: 42 }], 'draft', undefined],
    ['unknown token type', 'seg-1', [{ type: 'html', content: '<b>' }], 'draft', undefined],
    [
      'invalid metadata',
      'seg-1',
      [{ type: 'tag', content: '<b>', meta: null }],
      'draft',
      undefined,
    ],
    ['array metadata', 'seg-1', [{ type: 'tag', content: '<b>', meta: [] }], 'draft', undefined],
    [
      'invalid tag ID',
      'seg-1',
      [{ type: 'tag', content: '<b>', meta: { id: 1 } }],
      'draft',
      undefined,
    ],
    [
      'invalid tag type',
      'seg-1',
      [{ type: 'tag', content: '<b>', meta: { tagType: 'pair' } }],
      'draft',
      undefined,
    ],
    [
      'invalid pair index',
      'seg-1',
      [{ type: 'tag', content: '<b>', meta: { pairedIndex: NaN } }],
      'draft',
      undefined,
    ],
    [
      'invalid validation state',
      'seg-1',
      [{ type: 'tag', content: '<b>', meta: { validationState: true } }],
      'draft',
      undefined,
    ],
    ['missing status', 'seg-1', tokens, undefined, undefined],
    ['unknown status', 'seg-1', tokens, 'done', undefined],
    ['retired new status', 'seg-1', tokens, 'new', undefined],
    ['retired translated status', 'seg-1', tokens, 'translated', undefined],
    ['retired reviewed status', 'seg-1', tokens, 'reviewed', undefined],
    ['prototype status', 'seg-1', tokens, 'toString', undefined],
    ['invalid request ID', 'seg-1', tokens, 'draft', 123],
  ])('rejects %s before calling the service', (_name, ...args) => {
    const { invoke, updateSegment } = setup();
    expect(() => invoke(...args)).toThrow();
    expect(updateSegment).not.toHaveBeenCalled();
  });

  it.each<SegmentStatus>(['empty', 'draft', 'confirmed'])(
    'preserves valid tokens, metadata, and %s status',
    async (status) => {
      const { invoke, updateSegment, result } = setup();
      const target: Token[] = [
        { type: 'text', content: 'Translation' },
        { type: 'ws', content: '\n' },
        { type: 'locked', content: '{name}' },
        { type: 'tag', content: '<br>' },
        {
          type: 'tag',
          content: '<i>',
          meta: {
            id: undefined,
            tagType: undefined,
            pairedIndex: undefined,
            validationState: undefined,
          },
        },
        {
          type: 'tag',
          content: '<b>',
          meta: {
            id: 'b-1',
            tagType: 'paired-start',
            pairedIndex: 2,
            validationState: 'valid',
            custom: { preserved: true },
          },
        },
      ];
      await expect(invoke('seg-1', target, status, 'request-1')).resolves.toBe(result);
      expect(updateSegment).toHaveBeenCalledWith('seg-1', target, status, 'request-1');
      expect(updateSegment.mock.calls[0][1]).toBe(target);
    },
  );

  it('allows clearing a target and omitting the request ID', async () => {
    const { invoke, updateSegment } = setup();
    await invoke('seg-1', [], 'empty');
    expect(updateSegment).toHaveBeenCalledWith('seg-1', [], 'empty', undefined);
  });
});

describe('selected segment update handler', () => {
  const valid = { segmentId: 's1', targetTokens: [], status: 'empty' };
  it.each([
    undefined,
    [],
    new Array(1),
    [null],
    [valid, valid],
    [{ ...valid, status: 'bad' }],
    [{ ...valid, targetTokens: [{ type: 'html', content: '<b>' }] }],
    [{ ...valid, segmentId: '' }],
  ])('rejects malformed or duplicate updates %j', (updates) => {
    const { invokeSelected, updateSelectedSegments } = setup();
    expect(() => invokeSelected(1, updates)).toThrow();
    expect(updateSelectedSegments).not.toHaveBeenCalled();
  });
  it('validates file IDs and forwards a valid scope unchanged', async () => {
    const { invokeSelected, updateSelectedSegments } = setup();
    expect(() => invokeSelected('1', [valid])).toThrow();
    const updates = [valid];
    await invokeSelected(1, updates);
    expect(updateSelectedSegments).toHaveBeenCalledWith(1, updates);
    expect(updateSelectedSegments.mock.calls[0][1]).toBe(updates);
  });
});
