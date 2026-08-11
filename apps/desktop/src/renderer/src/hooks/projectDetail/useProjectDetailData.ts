import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

export type ProjectTMLoadState =
  | { status: 'loading' }
  | { status: 'refreshing' }
  | { status: 'ready' }
  | { status: 'error'; message: string; hasLoaded: boolean };

export interface UseProjectDetailDataResult {
  project: Project | null;
  setProject: React.Dispatch<React.SetStateAction<Project | null>>;
  files: ProjectFileRecord[];
  setFiles: React.Dispatch<React.SetStateAction<ProjectFileRecord[]>>;
  mountedTMs: MountedTM[];
  allMainTMs: TMRecord[];
  tmLoadState: ProjectTMLoadState;
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
}

export function createProjectDetailDataLoaders({ projectId, api }: ProjectDetailDataLoaderDeps) {
  return {
    loadData: async () => {
      const [project, files] = await Promise.all([
        api.getProject(projectId),
        api.getProjectFiles(projectId),
      ]);
      return { project: project ?? null, files };
    },
    loadMountedTMs: () => api.getProjectMountedTMs(projectId),
    loadTMData: async () => {
      const [mountedTMs, allMainTMs] = await Promise.all([
        api.getProjectMountedTMs(projectId),
        api.listTMOptions('main'),
      ]);
      return { mountedTMs, allMainTMs };
    },
    loadTBData: async () => {
      const [mountedTBs, allTBs] = await Promise.all([
        api.getProjectMountedTBs(projectId),
        api.listTBs(),
      ]);
      return { mountedTBs, allTBs };
    },
  };
}

function hasLoadedTMData(state: ProjectTMLoadState): boolean {
  return (
    state.status === 'ready' ||
    state.status === 'refreshing' ||
    (state.status === 'error' && state.hasLoaded)
  );
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
  const [tmLoadState, setTmLoadState] = useState<ProjectTMLoadState>({ status: 'loading' });
  const activeProjectIdRef = useRef(projectId);
  const tmLoadGenerationRef = useRef(0);
  const isMountedRef = useRef(true);
  activeProjectIdRef.current = projectId;

  const loading = loadingData || mutating;
  const isActiveProject = useCallback(
    () => isMountedRef.current && activeProjectIdRef.current === projectId,
    [projectId],
  );

  const dataLoaders = useMemo(
    () =>
      createProjectDetailDataLoaders({
        projectId,
        api: apiClient,
      }),
    [projectId],
  );

  const loadData = useCallback(async () => {
    if (!isActiveProject()) return;
    setLoadingData(true);
    try {
      const data = await dataLoaders.loadData();
      if (!isActiveProject()) return;
      setProject(data.project);
      setFiles(data.files);
    } catch (error) {
      if (!isActiveProject()) return;
      console.error('Failed to load project details:', error);
    } finally {
      if (isActiveProject()) {
        setLoadingData(false);
      }
    }
  }, [dataLoaders, isActiveProject]);

  const loadMountedTMs = useCallback(async () => {
    try {
      const mounted = await dataLoaders.loadMountedTMs();
      if (!isActiveProject()) return [];
      setMountedTMs(mounted);
      return mounted;
    } catch (error) {
      if (!isActiveProject()) return [];
      console.error('Failed to load mounted TMs:', error);
      return [];
    }
  }, [dataLoaders, isActiveProject]);

  const loadTMData = useCallback(async () => {
    if (!isActiveProject()) return;
    const generation = ++tmLoadGenerationRef.current;
    const isCurrent = () => isActiveProject() && tmLoadGenerationRef.current === generation;
    setTmLoadState((current) =>
      hasLoadedTMData(current) ? { status: 'refreshing' } : { status: 'loading' },
    );
    try {
      const data = await dataLoaders.loadTMData();
      if (!isCurrent()) return;
      setMountedTMs(data.mountedTMs);
      setAllMainTMs(data.allMainTMs);
      setTmLoadState({ status: 'ready' });
    } catch (error) {
      if (!isCurrent()) return;
      console.error('Failed to load project TM details:', error);
      const message =
        error instanceof Error ? error.message : 'Failed to load translation memories.';
      setTmLoadState((current) => ({
        status: 'error',
        message,
        hasLoaded: hasLoadedTMData(current),
      }));
    }
  }, [dataLoaders, isActiveProject]);

  const loadTBData = useCallback(async () => {
    try {
      const data = await dataLoaders.loadTBData();
      if (!isActiveProject()) return;
      setMountedTBs(data.mountedTBs);
      setAllTBs(data.allTBs);
    } catch (error) {
      if (!isActiveProject()) return;
      console.error('Failed to load project TB details:', error);
    }
  }, [dataLoaders, isActiveProject]);

  useEffect(() => {
    setProject(null);
    setFiles([]);
    setMountedTMs([]);
    setAllMainTMs([]);
    setTmLoadState({ status: 'loading' });
    setMountedTBs([]);
    setAllTBs([]);
  }, [projectId]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      tmLoadGenerationRef.current += 1;
    };
  }, []);

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
    tmLoadState,
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
