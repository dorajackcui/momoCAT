import type { IpcRendererEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { DesktopApiSlice, IpcRendererLike } from './types';

type EventApiKeys =
  | 'onSegmentsUpdated'
  | 'onSegmentsUpdatedBatch'
  | 'onProgress'
  | 'onJobProgress'
  | 'onAppUpdateStatus'
  | 'onReferenceDataChanged';

export function createEventApi(ipcRenderer: IpcRendererLike): DesktopApiSlice<EventApiKeys> {
  return {
    onSegmentsUpdated: (callback) => {
      const listener = (_event: IpcRendererEvent, ...args: unknown[]) => {
        const [data] = args as [Parameters<typeof callback>[0]];
        callback(data);
      };
      ipcRenderer.on(IPC_CHANNELS.events.segmentsUpdated, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.events.segmentsUpdated, listener);
    },
    onSegmentsUpdatedBatch: (callback) => {
      const listener = (_event: IpcRendererEvent, ...args: unknown[]) => {
        const [batch] = args as [Parameters<typeof callback>[0]];
        callback(batch);
      };
      ipcRenderer.on(IPC_CHANNELS.events.segmentsUpdatedBatch, listener);
      return () =>
        ipcRenderer.removeListener(IPC_CHANNELS.events.segmentsUpdatedBatch, listener);
    },
    onProgress: (callback) => {
      const listener = (_event: IpcRendererEvent, ...args: unknown[]) => {
        const [data] = args as [Parameters<typeof callback>[0]];
        callback(data);
      };
      ipcRenderer.on(IPC_CHANNELS.events.appProgress, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.events.appProgress, listener);
    },
    onJobProgress: (callback) => {
      const listener = (_event: IpcRendererEvent, ...args: unknown[]) => {
        const [progress] = args as [Parameters<typeof callback>[0]];
        callback(progress);
      };
      ipcRenderer.on(IPC_CHANNELS.events.jobProgress, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.events.jobProgress, listener);
    },
    onAppUpdateStatus: (callback) => {
      const listener = (_event: IpcRendererEvent, ...args: unknown[]) => {
        const [status] = args as [Parameters<typeof callback>[0]];
        callback(status);
      };
      ipcRenderer.on(IPC_CHANNELS.events.appUpdateStatus, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.events.appUpdateStatus, listener);
    },
    onReferenceDataChanged: (callback) => {
      const listener = (_event: IpcRendererEvent, ...args: unknown[]) => {
        const [event] = args as [Parameters<typeof callback>[0]];
        callback(event);
      };
      ipcRenderer.on(IPC_CHANNELS.events.referenceDataChanged, listener);
      return () =>
        ipcRenderer.removeListener(IPC_CHANNELS.events.referenceDataChanged, listener);
    },
  };
}
