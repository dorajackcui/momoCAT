import { CLOUD_CHANNELS, type CloudApi } from '../../shared/cloud';
import type { IpcRendererLike } from './types';

export function createCloudApi(ipc: IpcRendererLike): CloudApi {
  return {
    onCloudCloseRequested: (callback) => {
      const listener = () => callback();
      ipc.on('cloud-close-requested', listener);
      return () => ipc.removeListener('cloud-close-requested', listener);
    },
    cloudStatus: () =>
      ipc.invoke(CLOUD_CHANNELS.cloudStatus) as ReturnType<CloudApi['cloudStatus']>,
    cloudStartLogin: () =>
      ipc.invoke(CLOUD_CHANNELS.cloudStartLogin) as ReturnType<CloudApi['cloudStartLogin']>,
    cloudPollLogin: () => ipc.invoke(CLOUD_CHANNELS.cloudPollLogin) as Promise<boolean>,
    cloudLogout: () => ipc.invoke(CLOUD_CHANNELS.cloudLogout) as Promise<void>,
    cloudListProjects: () =>
      ipc.invoke(CLOUD_CHANNELS.cloudListProjects) as ReturnType<CloudApi['cloudListProjects']>,
    cloudCreateProject: (...args) =>
      ipc.invoke(CLOUD_CHANNELS.cloudCreateProject, ...args) as ReturnType<
        CloudApi['cloudCreateProject']
      >,
    cloudOpenProject: (id, keepLocal) =>
      ipc.invoke(CLOUD_CHANNELS.cloudOpenProject, id, keepLocal) as Promise<number>,
    cloudSync: (allProjects) =>
      (allProjects === undefined
        ? ipc.invoke(CLOUD_CHANNELS.cloudSync)
        : ipc.invoke(CLOUD_CHANNELS.cloudSync, allProjects)) as ReturnType<CloudApi['cloudSync']>,
    cloudCancelClose: () => ipc.invoke(CLOUD_CHANNELS.cloudCancelClose) as Promise<void>,
    cloudOpenResources: (kind, keepLocal) =>
      ipc.invoke(CLOUD_CHANNELS.cloudOpenResources, kind, keepLocal) as Promise<void>,
    cloudLeaveContext: (keepLocal, closeWindow) =>
      ipc.invoke(CLOUD_CHANNELS.cloudLeaveContext, keepLocal, closeWindow) as Promise<void>,
    cloudListLocalResources: (kind) =>
      ipc.invoke(CLOUD_CHANNELS.cloudListLocalResources, kind) as ReturnType<
        CloudApi['cloudListLocalResources']
      >,
    cloudCopyResource: (kind, id) =>
      ipc.invoke(CLOUD_CHANNELS.cloudCopyResource, kind, id) as ReturnType<
        CloudApi['cloudCopyResource']
      >,
    cloudResolveConflict: () =>
      ipc.invoke(CLOUD_CHANNELS.cloudResolveConflict) as ReturnType<
        CloudApi['cloudResolveConflict']
      >,
    cloudPull: () => ipc.invoke(CLOUD_CHANNELS.cloudPull) as Promise<number>,
    cloudCloseProject: (keepLocal, closeWindow) =>
      ipc.invoke(CLOUD_CHANNELS.cloudCloseProject, keepLocal, closeWindow) as Promise<void>,
  };
}
