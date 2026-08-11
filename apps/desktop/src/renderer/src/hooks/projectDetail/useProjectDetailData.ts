import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project } from '@cat/core/project';
import type {
  DesktopApi,
  MountedTB,
  MountedTM,
  ProjectFileRecord,
  TBWithStats,
  TMBatchMatchResult,
  TMCommitOptions,
  TMRecord,
} from '../../../../shared/ipc';
import { apiClient } from '../../services/apiClient';

export interface UseProjectDetailDataResult {
  project: Project | null;
  setProject: React.Dispatch<React.SetStateAction<Project | null>>;
  files: ProjectFileRecord[];
  setFiles: React.Dispatch<React.SetStateAction<ProjectFileRecord[]>>;
  mountedTMs: MountedTM[];
  allMainTMs: TMRecord[];
  tmLoading: boolean;
  tmError: string | null;
  mountedTBs: MountedTB[];
  allTBs: TBWithStats[];
  loading: boolean;
  loadData: () => Promise<void>;
  loadMountedTMs: () => Promise<MountedTM[]>;
  loadTMData: () => Promise<void>;
  loadTBData: () => Promise<void>;
  runMutation: <T>(fn: () => Promise<T>) => Promise<T>;
  mountTM: (tmId: string) => Promise<void>;
  unmountTM: (tmId: string) => Promise<void>;
  mountTB: (tbId: string) => Promise<void>;
  unmountTB: (tbId: string) => Promise<void>;
  commitToMainTM: (tmId: string, fileId: number, options?: TMCommitOptions) => Promise<number>;
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

type ProjectDetailDataApi = Pick<
  DesktopApi,
  | 'getProject'
  | 'getProjectFiles'
  | 'getProjectMountedTMs'
  | 'listTMOptions'
  | 'getProjectMountedTBs'
  | 'listTBs'
>;

interface ProjectDetailDataLoaderDeps {
  projectId: number;
  api: ProjectDetailDataApi;
  setProject: (project: Project | null) => void;
  setFiles: (files: ProjectFileRecord[]) => void;
  setMountedTMs: (mountedTMs: MountedTM[]) => void;
  setAllMainTMs: (allMainTMs: TMRecord[]) => void;
  setMountedTBs: (mountedTBs: MountedTB[]) => void;
  setAllTBs: (allTBs: TBWithStats[]) => void;
  setLoadingData: (loading: boolean) => void;
}

export function createProjectDetailDataLoaders({
  projectId,
  api,
  setProject,
  setFiles,
  setMountedTMs,
  setAllMainTMs,
  setMountedTBs,
  setAllTBs,
  setLoadingData,
}: ProjectDetailDataLoaderDeps) {
  const loadMountedTMs = async () => {
    const mounted = await api.getProjectMountedTMs(projectId);
    setMountedTMs(mounted);
    return mounted;
  };

  return {
    loadData: async () => {
      setLoadingData(true);
      try {
        const [p, f] = await Promise.all([
          api.getProject(projectId),
          api.getProjectFiles(projectId),
        ]);

        setProject(p ?? null);
        setFiles(f);
      } finally {
        setLoadingData(false);
      }
    },
    loadMountedTMs,
    loadTMData: async () => {
      const [mounted, allMain] = await Promise.all([
        api.getProjectMountedTMs(projectId),
        api.listTMOptions('main'),
      ]);

      setMountedTMs(mounted);
      setAllMainTMs(allMain);
    },
    loadTBData: async () => {
      const [mountedTB, allTB] = await Promise.all([
        api.getProjectMountedTBs(projectId),
        api.listTBs(),
      ]);

      setMountedTBs(mountedTB);
      setAllTBs(allTB);
    },
  };
}

interface ProjectDetailActionDeps {
  projectId: number;
  api: ProjectDetailApi;
  loadData: () => Promise<void>;
  loadTMData?: () => Promise<void>;
  loadTBData?: () => Promise<void>;
  runMutation: <T>(fn: () => Promise<T>) => Promise<T>;
}

export function createProjectDetailActions({
  projectId,
  api,
  loadData,
  loadTMData,
  loadTBData,
  runMutation,
}: ProjectDetailActionDeps) {
  return {
    mountTM: async (tmId: string) => {
      await runMutation(async () => {
        await api.mountTMToProject(projectId, tmId);
        await (loadTMData ?? loadData)();
      });
    },
    unmountTM: async (tmId: string) => {
      await runMutation(async () => {
        await api.unmountTMFromProject(projectId, tmId);
        await (loadTMData ?? loadData)();
      });
    },
    mountTB: async (tbId: string) => {
      await runMutation(async () => {
        await api.mountTBToProject(projectId, tbId);
        await (loadTBData ?? loadData)();
      });
    },
    unmountTB: async (tbId: string) => {
      await runMutation(async () => {
        await api.unmountTBFromProject(projectId, tbId);
        await (loadTBData ?? loadData)();
      });
    },
    commitToMainTM: async (tmId: string, fileId: number, options?: TMCommitOptions) => {
      return runMutation(async () => {
        const count = await api.commitToMainTM(tmId, fileId, options);
        await loadData();
        if (loadTMData) {
          await loadTMData();
        }
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
  const [allMainTMs, setAllMainTMs] = useState<TMRecord[]>([]);
  const [mountedTBs, setMountedTBs] = useState<MountedTB[]>([]);
  const [allTBs, setAllTBs] = useState<TBWithStats[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [tmLoading, setTmLoading] = useState(true);
  const [tmError, setTmError] = useState<string | null>(null);

  const loading = loadingData || mutating;

  const dataLoaders = useMemo(
    () =>
      createProjectDetailDataLoaders({
        projectId,
        api: apiClient,
        setProject,
        setFiles,
        setMountedTMs,
        setAllMainTMs,
        setMountedTBs,
        setAllTBs,
        setLoadingData,
      }),
    [projectId],
  );

  const loadData = useCallback(async () => {
    try {
      await dataLoaders.loadData();
    } catch (error) {
      console.error('Failed to load project details:', error);
      setLoadingData(false);
    }
  }, [dataLoaders]);

  const loadMountedTMs = useCallback(async () => {
    try {
      return await dataLoaders.loadMountedTMs();
    } catch (error) {
      console.error('Failed to load mounted TMs:', error);
      return [];
    }
  }, [dataLoaders]);

  const loadTMData = useCallback(async () => {
    setTmLoading(true);
    setTmError(null);
    try {
      await dataLoaders.loadTMData();
    } catch (error) {
      console.error('Failed to load project TM details:', error);
      setTmError(error instanceof Error ? error.message : 'Failed to load translation memories.');
    } finally {
      setTmLoading(false);
    }
  }, [dataLoaders]);

  const loadTBData = useCallback(async () => {
    try {
      await dataLoaders.loadTBData();
    } catch (error) {
      console.error('Failed to load project TB details:', error);
    }
  }, [dataLoaders]);

  useEffect(() => {
    setProject(null);
    setFiles([]);
    setMountedTMs([]);
    setAllMainTMs([]);
    setTmLoading(true);
    setTmError(null);
    setMountedTBs([]);
    setAllTBs([]);
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
        loadTMData,
        loadTBData,
        runMutation,
      }),
    [loadData, loadTBData, loadTMData, projectId, runMutation],
  );

  return {
    project,
    setProject,
    files,
    setFiles,
    mountedTMs,
    allMainTMs,
    tmLoading,
    tmError,
    mountedTBs,
    allTBs,
    loading,
    loadData,
    loadMountedTMs,
    loadTMData,
    loadTBData,
    runMutation,
    mountTM: actions.mountTM,
    unmountTM: actions.unmountTM,
    mountTB: actions.mountTB,
    unmountTB: actions.unmountTB,
    commitToMainTM: actions.commitToMainTM,
    matchFileWithTM: actions.matchFileWithTM,
  };
}
