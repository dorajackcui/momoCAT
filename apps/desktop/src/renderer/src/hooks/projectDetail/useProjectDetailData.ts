import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project } from '@cat/core/project';
import type {
  DesktopApi,
  MountedTB,
  MountedTM,
  ProjectFileRecord,
  TBWithStats,
  TMBatchMatchResult,
  TMWithStats,
} from '../../../../shared/ipc';
import { apiClient } from '../../services/apiClient';

export interface UseProjectDetailDataResult {
  project: Project | null;
  setProject: React.Dispatch<React.SetStateAction<Project | null>>;
  files: ProjectFileRecord[];
  mountedTMs: MountedTM[];
  allMainTMs: TMWithStats[];
  mountedTBs: MountedTB[];
  allTBs: TBWithStats[];
  loading: boolean;
  loadData: () => Promise<void>;
  runMutation: <T>(fn: () => Promise<T>) => Promise<T>;
  mountTM: (tmId: string) => Promise<void>;
  unmountTM: (tmId: string) => Promise<void>;
  mountTB: (tbId: string) => Promise<void>;
  unmountTB: (tbId: string) => Promise<void>;
  commitToMainTM: (tmId: string, fileId: number) => Promise<number>;
  matchFileWithTM: (fileId: number, tmId: string) => Promise<TMBatchMatchResult>;
}

type ProjectDetailApi = Pick<
  DesktopApi,
  | 'mountTMToProject'
  | 'unmountTMFromProject'
  | 'mountTBToProject'
  | 'unmountTBFromProject'
  | 'commitToMainTM'
  | 'matchFileWithTM'
>;

interface ProjectDetailActionDeps {
  projectId: number;
  api: ProjectDetailApi;
  loadData: () => Promise<void>;
  runMutation: <T>(fn: () => Promise<T>) => Promise<T>;
}

export function createProjectDetailActions({
  projectId,
  api,
  loadData,
  runMutation,
}: ProjectDetailActionDeps) {
  return {
    mountTM: async (tmId: string) => {
      await runMutation(async () => {
        await api.mountTMToProject(projectId, tmId);
        await loadData();
      });
    },
    unmountTM: async (tmId: string) => {
      await runMutation(async () => {
        await api.unmountTMFromProject(projectId, tmId);
        await loadData();
      });
    },
    mountTB: async (tbId: string) => {
      await runMutation(async () => {
        await api.mountTBToProject(projectId, tbId);
        await loadData();
      });
    },
    unmountTB: async (tbId: string) => {
      await runMutation(async () => {
        await api.unmountTBFromProject(projectId, tbId);
        await loadData();
      });
    },
    commitToMainTM: async (tmId: string, fileId: number) => {
      return runMutation(async () => {
        const count = await api.commitToMainTM(tmId, fileId);
        await loadData();
        return count;
      });
    },
    matchFileWithTM: async (fileId: number, tmId: string) => {
      return runMutation(async () => {
        const result = await api.matchFileWithTM(fileId, tmId);
        await loadData();
        return result;
      });
    },
  };
}

export function useProjectDetailData(projectId: number): UseProjectDetailDataResult {
  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<ProjectFileRecord[]>([]);
  const [mountedTMs, setMountedTMs] = useState<MountedTM[]>([]);
  const [allMainTMs, setAllMainTMs] = useState<TMWithStats[]>([]);
  const [mountedTBs, setMountedTBs] = useState<MountedTB[]>([]);
  const [allTBs, setAllTBs] = useState<TBWithStats[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [mutating, setMutating] = useState(false);

  const loading = loadingData || mutating;

  const loadData = useCallback(async () => {
    setLoadingData(true);
    try {
      const p = await apiClient.getProject(projectId);
      const f = await apiClient.getProjectFiles(projectId);
      const mounted = await apiClient.getProjectMountedTMs(projectId);
      const allMain = await apiClient.listTMs('main');
      const mountedTB = await apiClient.getProjectMountedTBs(projectId);
      const allTB = await apiClient.listTBs();

      setProject(p ?? null);
      setFiles(f);
      setMountedTMs(mounted);
      setAllMainTMs(allMain);
      setMountedTBs(mountedTB);
      setAllTBs(allTB);
    } catch (error) {
      console.error('Failed to load project details:', error);
    } finally {
      setLoadingData(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const runMutation = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    setMutating(true);
    try {
      return await fn();
    } finally {
      setMutating(false);
    }
  }, []);

  const actions = useMemo(
    () =>
      createProjectDetailActions({
        projectId,
        api: apiClient,
        loadData,
        runMutation,
      }),
    [loadData, projectId, runMutation],
  );

  return {
    project,
    setProject,
    files,
    mountedTMs,
    allMainTMs,
    mountedTBs,
    allTBs,
    loading,
    loadData,
    runMutation,
    mountTM: actions.mountTM,
    unmountTM: actions.unmountTM,
    mountTB: actions.mountTB,
    unmountTB: actions.unmountTB,
    commitToMainTM: actions.commitToMainTM,
    matchFileWithTM: actions.matchFileWithTM,
  };
}
