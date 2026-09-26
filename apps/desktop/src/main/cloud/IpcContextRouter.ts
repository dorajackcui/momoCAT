import type { IpcMainLike, IpcMainListener, IpcMainInvokeEventLike } from '../ipc/types';

export class IpcContextRouter {
  private readonly defaults = new Map<string, IpcMainListener>();
  private readonly contexts = new Map<
    number,
    { handlers: Map<string, IpcMainListener>; before: (channel: string) => void }
  >();
  private readonly active = new Map<number, number>();
  readonly local: IpcMainLike;

  constructor(ipcMain: IpcMainLike) {
    this.local = {
      handle: (channel, listener) => {
        this.defaults.set(channel, listener);
        ipcMain.handle(channel, (event, ...args) => this.invoke(channel, event, args));
      },
    };
  }

  bind(senderId: number, before: (channel: string) => void): IpcMainLike {
    const handlers = new Map<string, IpcMainListener>();
    this.contexts.set(senderId, { handlers, before });
    return {
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      },
    };
  }

  remove(senderId: number): void {
    this.contexts.delete(senderId);
  }
  has(senderId: number): boolean {
    return this.contexts.has(senderId);
  }

  isBusy(senderId: number): boolean {
    return (this.active.get(senderId) ?? 0) > 0;
  }

  private invoke(channel: string, event: IpcMainInvokeEventLike, args: unknown[]): unknown {
    const context = event.sender ? this.contexts.get(event.sender.id) : undefined;
    if (context) context.before(channel);
    const listener = context?.handlers.get(channel) ?? this.defaults.get(channel);
    if (!listener) throw new Error('IPC handler unavailable');
    const id = event.sender?.id;
    if (id === undefined) return listener(event, ...args);
    this.active.set(id, (this.active.get(id) ?? 0) + 1);
    return Promise.resolve()
      .then(() => listener(event, ...args))
      .finally(() => {
        const remaining = (this.active.get(id) ?? 1) - 1;
        if (remaining) this.active.set(id, remaining);
        else this.active.delete(id);
      });
  }
}
