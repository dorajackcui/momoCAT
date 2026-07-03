import type { Dialog } from 'electron';
import type { ReferenceDataChangedEvent } from '../../shared/ipc';
import type { ProjectService } from '../services/ProjectService';
import type { JobManager } from '../JobManager';
import type { ReferenceLookupService } from '../services/referenceLookup/types';

export interface IpcMainLike {
  handle: (channel: string, listener: IpcMainListener) => void;
  removeHandler?: (channel: string) => void;
}

export interface IpcMainInvokeEventLike {
  senderFrame?: {
    url: string;
  } | null;
}

export type IpcMainListener = (
  event: IpcMainInvokeEventLike,
  ...args: unknown[]
) => unknown;

export interface MainHandlerDeps {
  ipcMain: IpcMainLike;
  projectService: ProjectService;
}

export interface AIHandlerDeps extends MainHandlerDeps {
  jobManager: JobManager;
}

export interface JobBackedHandlerDeps extends MainHandlerDeps {
  jobManager: JobManager;
}

export type ReferenceDataChangedNotifier = (event: ReferenceDataChangedEvent) => void;

export interface ReferenceBackedHandlerDeps extends JobBackedHandlerDeps {
  referenceLookup: ReferenceLookupService;
  referenceLookupPrefetch: ReferenceLookupService;
  notifyReferenceDataChanged: ReferenceDataChangedNotifier;
}

export interface DialogHandlerDeps {
  ipcMain: IpcMainLike;
  dialog: Pick<Dialog, 'showOpenDialog' | 'showSaveDialog'>;
}

export interface ClipboardLike {
  readText: () => string;
  readHTML: () => string;
}

export interface ClipboardHandlerDeps {
  ipcMain: IpcMainLike;
  clipboard: ClipboardLike;
}
