import { describe, expect, it, vi } from 'vitest';
import { IpcContextRouter } from './IpcContextRouter';
import type { IpcMainListener } from '../ipc/types';

describe('window-scoped cloud IPC', () => {
  it('routes identical local ids to their owning window and guards even fallback handlers', async () => {
    const handlers = new Map<string, IpcMainListener>();
    const router = new IpcContextRouter({
      handle: (channel, fn) => {
        handlers.set(channel, fn);
      },
    });
    router.local.handle('get', () => 'local project 1');
    router.local.handle('delete', () => 'local deletion');
    const before = vi.fn((channel: string) => {
      if (channel === 'delete') throw new Error('Forbidden');
    });
    const cloud = router.bind(2, before);
    cloud.handle('get', () => 'cloud project 1');
    expect(await handlers.get('get')!({ sender: { id: 1 } })).toBe('local project 1');
    expect(await handlers.get('get')!({ sender: { id: 2 } })).toBe('cloud project 1');
    expect(() => handlers.get('delete')!({ sender: { id: 2 } })).toThrow('Forbidden');
    expect(before).toHaveBeenCalledWith('delete');
    router.remove(2);
    expect(router.has(2)).toBe(false);
  });
});
