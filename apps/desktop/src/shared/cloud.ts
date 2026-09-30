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
export type CloudResourceKind = 'tm' | 'tb';
export interface CloudResourceSummary {
  id: string;
  name: string;
  srcLang: string;
  tgtLang: string;
  kind?: CloudResourceKind;
}
export interface CloudSyncResult {
  projectId?: number;
  changed: boolean;
  localCopyProjectId?: number;
  localCopyName?: string;
}
export interface CloudStatus {
  configured: boolean;
  configurationError?: string;
  account: CloudAccount | null;
  context?: 'cloud';
  resourceKind?: CloudResourceKind;
  pending?: boolean;
  pendingElsewhere?: boolean;
  cacheRevision?: number;
  syncing?: boolean;
  lastSyncedAt?: string;
  error?: string;
  conflict?: boolean;
  project?: {
    id: string;
    projectId: number;
    name: string;
    revision: number;
    pending: boolean;
    writable: boolean;
    syncing?: boolean;
    lastSyncedAt?: string;
    conflict?: boolean;
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
  cloudSync: (allProjects?: boolean) => Promise<CloudSyncResult>;
  cloudCancelClose: () => Promise<void>;
  cloudOpenResources: (kind: CloudResourceKind, keepLocal?: boolean) => Promise<void>;
  cloudLeaveContext: (keepLocal?: boolean, closeWindow?: boolean) => Promise<void>;
  cloudListLocalResources: (kind: CloudResourceKind) => Promise<CloudResourceSummary[]>;
  cloudCopyResource: (kind: CloudResourceKind, id: string) => Promise<CloudResourceSummary>;
  cloudResolveConflict: () => Promise<CloudSyncResult>;
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
  cloudCancelClose: 'cloud-cancel-close',
  cloudPull: 'cloud-pull',
  cloudOpenResources: 'cloud-open-resources',
  cloudLeaveContext: 'cloud-leave-context',
  cloudListLocalResources: 'cloud-list-local-resources',
  cloudCopyResource: 'cloud-copy-resource',
  cloudResolveConflict: 'cloud-resolve-conflict',
  cloudCloseProject: 'cloud-close-project',
} as const;
