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
    cloudSync: () => ipc.invoke(CLOUD_CHANNELS.cloudSync) as Promise<void>,
    cloudPull: () => ipc.invoke(CLOUD_CHANNELS.cloudPull) as Promise<number>,
    cloudCloseProject: (keepLocal, closeWindow) =>
      ipc.invoke(CLOUD_CHANNELS.cloudCloseProject, keepLocal, closeWindow) as Promise<void>,
  };
}
