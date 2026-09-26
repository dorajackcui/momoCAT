import type { ProjectType } from '@cat/core/project';

export interface CloudAccount {
  id: string;
  name: string;
  email: string;
}
export interface CloudProjectSummary {
  id: string;
  name: string;
  revision: number;
}
export interface CloudStatus {
  configured: boolean;
  configurationError?: string;
  account: CloudAccount | null;
  project?: {
    id: string;
    projectId: number;
    name: string;
    revision: number;
    pending: boolean;
    writable: boolean;
    error?: string;
  };
}
export interface CloudApi {
  cloudStatus: () => Promise<CloudStatus>;
  cloudStartLogin: () => Promise<{ userCode: string }>;
  cloudPollLogin: () => Promise<boolean>;
  cloudLogout: () => Promise<void>;
  cloudListProjects: () => Promise<CloudProjectSummary[]>;
  cloudCreateProject: (
    name: string,
    srcLang: string,
    tgtLang: string,
    type: ProjectType,
  ) => Promise<CloudProjectSummary>;
  cloudOpenProject: (id: string, keepLocal?: boolean) => Promise<number>;
  cloudSync: () => Promise<void>;
  cloudPull: () => Promise<number>;
  cloudCloseProject: (keepLocal?: boolean, closeWindow?: boolean) => Promise<void>;
  onCloudCloseRequested: (callback: () => void) => () => void;
}
export const CLOUD_CHANNELS = {
  cloudStatus: 'cloud-status',
  cloudStartLogin: 'cloud-start-login',
  cloudPollLogin: 'cloud-poll-login',
  cloudLogout: 'cloud-logout',
  cloudListProjects: 'cloud-list-projects',
  cloudCreateProject: 'cloud-create-project',
  cloudOpenProject: 'cloud-open-project',
  cloudSync: 'cloud-sync',
  cloudPull: 'cloud-pull',
  cloudCloseProject: 'cloud-close-project',
} as const;
