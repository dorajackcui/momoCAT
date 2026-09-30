import { Button } from './components/ui';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Project, ProjectType } from '@cat/core/project';
import type { CloudProjectSummary } from '../../shared/cloud';
import { CreateProjectModal } from './components/CreateProjectModal';
import { WorkspaceSidebar } from './components/WorkspaceSidebar';
import { ProjectDetail } from './components/ProjectDetail';
import { Editor } from './components/Editor';
import { TMManager } from './components/TMManager';
import { TBManager } from './components/TBManager';
import { SettingsPage } from './components/SettingsPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAIFileJobTracker } from './hooks/aiFileJobs';
import { useProjects } from './hooks/useProjects';
import { FeedbackHost } from './services/FeedbackHost';
import { feedbackService } from './services/feedbackService';
import { useAppUpdates } from './hooks/useAppUpdates';
import { useWorkspaceNavigation, type WorkspaceView } from './hooks/useWorkspaceNavigation';
import { ThemeProvider } from './theme/ThemeProvider';
import { TypographyProvider } from './theme/TypographyProvider';
import {
  CloudAccountControls,
  CloudSyncControl,
  CloudCloseDialog,
  useCloudStatus,
  type CloudCloseChoice,
} from './components/CloudControls';

function App(): JSX.Element {
  const { view, pending, runGuarded, registerGuard } = useWorkspaceNavigation();
  const appearanceScope = view.kind === 'editor' ? 'editor' : 'workspace';
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [cloudClosePrompt, setCloudClosePrompt] = useState(false);
  const cloudCloseResolver = useRef<((choice: CloudCloseChoice) => void) | null>(null);
  const cloudCloseInProgress = useRef(false);
  const chooseCloudClose = useCallback((choice: CloudCloseChoice) => {
    const resolve = cloudCloseResolver.current;
    cloudCloseResolver.current = null;
    setCloudClosePrompt(false);
    resolve?.(choice);
  }, []);
  const requestCloudClose = useCallback(
    () =>
      new Promise<CloudCloseChoice>((resolve) => {
        cloudCloseResolver.current = resolve;
        setCloudClosePrompt(true);
      }),
    [],
  );
  useEffect(
    () => () => {
      cloudCloseResolver.current?.('cancel');
    },
    [],
  );
  const [workspaceGeneration, setWorkspaceGeneration] = useState(0);
  const [editorPositions, setEditorPositions] = useState<Record<string, string | null>>({});
  const { status: cloudStatus, refresh: refreshStatus } = useCloudStatus();
  const scope =
    view.cloudId ??
    (view.cloudResources ? `cloud-resources:${cloudStatus?.account?.id ?? ''}` : 'local');
  const rememberEditorPosition = useCallback(
    (fileId: number, segmentId: string | null) => {
      setEditorPositions((positions) => ({ ...positions, [`${scope}:${fileId}`]: segmentId }));
    },
    [scope],
  );
  const updates = useAppUpdates();
  const accountId = cloudStatus?.account?.id;
  const [cloudCatalog, setCloudCatalog] = useState<{
    accountId?: string;
    projects: CloudProjectSummary[];
    error: string;
  }>({ projects: [], error: '' });
  const cloudProjects = cloudCatalog.accountId === accountId ? cloudCatalog.projects : [];
  const cloudError = cloudCatalog.accountId === accountId ? cloudCatalog.error : '';
  const cloudAccountRef = useRef<string>();
  const refreshCloudProjects = useCallback(async () => {
    const owner = cloudAccountRef.current;
    if (!owner) return;
    try {
      const projects = await window.api.cloudListProjects();
      if (cloudAccountRef.current === owner)
        setCloudCatalog({ accountId: owner, projects, error: '' });
    } catch (error) {
      if (cloudAccountRef.current === owner)
        setCloudCatalog((current) => ({
          accountId: owner,
          projects: current.accountId === owner ? current.projects : [],
          error: error instanceof Error ? error.message : 'Cloud projects unavailable',
        }));
    }
  }, []);
  useEffect(() => {
    cloudAccountRef.current = accountId;
    if (accountId) void refreshCloudProjects();
    return () => {
      cloudAccountRef.current = undefined;
    };
  }, [accountId, refreshCloudProjects]);

  const closeCloud = useCallback(() => {
    if (cloudCloseInProgress.current) return;
    cloudCloseInProgress.current = true;
    let closed = false;
    let before = 0;
    void runGuarded(async () => {
      try {
        const latest = await window.api.cloudStatus();
        before = latest.cacheRevision ?? 0;
        if ((latest.pending ?? latest.project?.pending) || latest.pendingElsewhere) {
          const choice = await requestCloudClose();
          if (choice === 'cancel') return null;
          if (choice === 'sync') {
            await window.api.cloudSync(true);
            const synced = await refreshStatus();
            if (
              (synced?.pending ?? synced?.project?.pending) ||
              synced?.pendingElsewhere ||
              synced?.conflict ||
              synced?.project?.conflict
            ) {
              feedbackService.error(
                'Some changes could not be synced. Your work remains on this device.',
              );
              return null;
            }
          }
        }
        await window.api.cloudLeaveContext(true, true);
        closed = true;
      } catch (error) {
        const latest = await refreshStatus();
        feedbackService.error(
          error instanceof Error ? error.message : 'Could not close the cloud workspace.',
        );
        if ((view.cloudId || view.cloudResources) && (latest?.cacheRevision ?? 0) !== before) {
          setWorkspaceGeneration((value) => value + 1);
          if (latest?.project && (view.kind === 'editor' || view.kind === 'project'))
            return {
              kind: 'project',
              projectId: latest.project.projectId,
              cloudId: latest.project.id,
            };
          return view;
        }
      }
      return null;
    }).finally(() => {
      cloudCloseInProgress.current = false;
      if (!closed) void window.api.cloudCancelClose().catch(() => {});
    });
  }, [runGuarded, requestCloudClose, refreshStatus, view]);
  useEffect(() => window.api.onCloudCloseRequested?.(closeCloud), [closeCloud]);

  const navigate = (next: WorkspaceView) =>
    runGuarded(async () => {
      const current = await window.api.cloudStatus?.();
      if (current?.context === 'cloud' || current?.project) {
        if (next.kind === 'tm' || next.kind === 'tb') {
          await window.api.cloudOpenResources(next.kind, true);
          await refreshStatus();
          return { kind: next.kind, cloudResources: true };
        }
        if (!next.cloudId || next.cloudId !== current.project?.id) {
          await window.api.cloudLeaveContext(true);
          await refreshStatus();
        }
      }
      return next;
    });
  const changeResourceStorage = (kind: 'tm' | 'tb', storage: 'local' | 'cloud') => {
    void runGuarded(async () => {
      if (storage === 'cloud') {
        await window.api.cloudOpenResources(kind, true);
      } else {
        await window.api.cloudLeaveContext(true);
      }
      await refreshStatus();
      return { kind, cloudResources: storage === 'cloud' };
    });
  };
  const openCloud = (id: string) =>
    runGuarded(async () => {
      const projectId = await window.api.cloudOpenProject(id, true);
      await refreshStatus();
      return { kind: 'project', projectId, cloudId: id };
    });
  const cloudAction = (resolveConflict = false) => {
    void runGuarded(async () => {
      const before = (await window.api.cloudStatus()).cacheRevision ?? 0;
      const cloudView = !!view.cloudId || !!view.cloudResources;
      try {
        const result = resolveConflict
          ? await window.api.cloudResolveConflict()
          : await window.api.cloudSync(true);
        await refreshStatus();
        if (result.changed && cloudView) setWorkspaceGeneration((value) => value + 1);
        if (resolveConflict) {
          await loadProjects();
          feedbackService.success('Local copy saved. Latest cloud version is ready.');
        }
        if (
          result.changed &&
          result.projectId &&
          view.cloudId &&
          (view.kind === 'project' || view.kind === 'editor')
        )
          return { kind: 'project', projectId: result.projectId, cloudId: view.cloudId };
      } catch (error) {
        const latest = await refreshStatus();
        feedbackService.error(error instanceof Error ? error.message : 'Cloud operation failed');
        if (cloudView && (latest?.cacheRevision ?? 0) !== before) {
          setWorkspaceGeneration((value) => value + 1);
          if (latest?.project && (view.kind === 'editor' || view.kind === 'project'))
            return {
              kind: 'project',
              projectId: latest.project.projectId,
              cloudId: latest.project.id,
            };
        }
      } finally {
        void refreshCloudProjects();
      }
      return view;
    });
  };

  const { projects, loading, loadProjects, createProject, deleteProject } = useProjects();
  const aiFileJobTracker = useAIFileJobTracker();
  const handleCreateProject = async (
    name: string,
    srcLang: string,
    tgtLang: string,
    projectType: ProjectType,
    storage: 'local' | 'cloud',
  ) => {
    await runGuarded(async () => {
      if (storage === 'cloud') {
        const project = await window.api.cloudCreateProject(name, srcLang, tgtLang, projectType);
        await refreshCloudProjects();
        setIsCreateOpen(false);
        const projectId = await window.api.cloudOpenProject(project.id, true);
        await refreshStatus();
        return { kind: 'project', projectId, cloudId: project.id };
      }
      await window.api.cloudLeaveContext?.(true);
      await refreshStatus();
      const newProject = await createProject(name, srcLang, tgtLang, projectType);
      if (!newProject?.id) return { kind: 'home' };
      setIsCreateOpen(false);
      return { kind: 'project', projectId: newProject.id };
    });
  };

  const cloudControl = (
    <CloudSyncControl
      status={cloudStatus}
      disabled={pending || loading}
      onSync={() => cloudAction()}
      onResolveConflict={() => cloudAction(true)}
    />
  );
  const handleDeleteProject = (project: Project) => {
    if (!project.id) return;
    void runGuarded(async () => {
      // Local catalog actions must not be routed through a cloud cache.
      if (cloudStatus?.context === 'cloud' || cloudStatus?.project) {
        await window.api.cloudLeaveContext(true);
        await refreshStatus();
      }
      const deleted = await deleteProject(project.id!, project.name);
      if (!deleted) return cloudStatus?.project ? { kind: 'home' } : null;
      return view.cloudId || ('projectId' in view && view.projectId === project.id)
        ? { kind: 'home' }
        : view;
    });
  };

  return (
    <ThemeProvider scope={appearanceScope}>
      <TypographyProvider scope={appearanceScope}>
        <FeedbackHost />
        <CloudCloseDialog open={cloudClosePrompt} onChoose={chooseCloudClose} />
        <div className="workspace-shell">
          <WorkspaceSidebar
            hidden={view.kind === 'editor'}
            projects={projects}
            cloudProjects={cloudProjects}
            view={view}
            disabled={pending || loading}
            cloudError={cloudError}
            onNavigate={(next) => {
              void navigate(next);
            }}
            onOpenCloud={(id) => {
              void openCloud(id);
            }}
            cloudControl={view.kind === 'editor' ? undefined : cloudControl}
            onCreate={() => setIsCreateOpen(true)}
            onDelete={handleDeleteProject}
          />
          {isCreateOpen && (
            <CreateProjectModal
              isOpen
              onClose={() => {
                if (!pending) setIsCreateOpen(false);
              }}
              onConfirm={handleCreateProject}
              cloudStatus={cloudStatus}
              loading={loading || pending}
            />
          )}
          <main
            className="workspace-main"
            aria-label="Workspace"
            aria-busy={pending}
            ref={(element) => {
              if (element) element.inert = pending;
            }}
          >
            <ErrorBoundary
              key={`${workspaceGeneration}:${scope}:${view.kind === 'editor' ? `editor:${view.fileId}` : view.kind === 'project' ? `project:${view.projectId}` : view.kind}`}
            >
              {view.kind === 'home' && (
                <section className="workspace-home">
                  <div className="workspace-home-content">
                    <span className="text-sm text-text-muted">MomoCAT workspace</span>
                    <h1 className="mt-3 text-3xl font-semibold tracking-tight">Projects</h1>
                    <p className="mt-3 text-sm leading-6 text-text-muted">
                      {projects.length || cloudProjects.length
                        ? 'Choose a project in the sidebar to continue your work.'
                        : 'Create a project to start translating or processing your files.'}
                    </p>
                    <Button
                      variant="primary"
                      type="button"
                      className="mt-6"
                      onClick={() => setIsCreateOpen(true)}
                    >
                      + New project
                    </Button>
                  </div>
                </section>
              )}
              {view.kind === 'project' && (
                <ProjectDetail
                  projectId={view.projectId}
                  cloud={!!view.cloudId}
                  onBack={() => {
                    void navigate({ kind: 'home' });
                  }}
                  onOpenFile={(fileId) => {
                    void navigate({
                      kind: 'editor',
                      projectId: view.projectId,
                      fileId,
                      cloudId: view.cloudId,
                    });
                  }}
                  aiFileJobTracker={aiFileJobTracker}
                />
              )}
              {view.kind === 'editor' && (
                <Editor
                  fileId={view.fileId}
                  onBack={() => {
                    void navigate({
                      kind: 'project',
                      projectId: view.projectId,
                      cloudId: view.cloudId,
                    });
                  }}
                  aiFileJobTracker={aiFileJobTracker}
                  registerNavigationGuard={registerGuard}
                  initialActiveSegmentId={editorPositions[`${scope}:${view.fileId}`]}
                  onRememberPosition={rememberEditorPosition}
                  cloudControl={cloudControl}
                />
              )}
              {view.kind === 'tm' && (
                <TMManager
                  storage={view.cloudResources ? 'cloud' : 'local'}
                  cloudAvailable={!!cloudStatus?.account}
                  onStorageChange={(storage) => changeResourceStorage('tm', storage)}
                />
              )}
              {view.kind === 'tb' && (
                <TBManager
                  storage={view.cloudResources ? 'cloud' : 'local'}
                  cloudAvailable={!!cloudStatus?.account}
                  onStorageChange={(storage) => changeResourceStorage('tb', storage)}
                />
              )}
              {view.kind === 'settings' && (
                <SettingsPage
                  updates={updates}
                  account={<CloudAccountControls status={cloudStatus} />}
                />
              )}
            </ErrorBoundary>
          </main>
        </div>
      </TypographyProvider>
    </ThemeProvider>
  );
}
export default App;
