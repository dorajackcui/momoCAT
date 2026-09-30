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
import { CloudAccountControls, CloudBanner, useCloudStatus } from './components/CloudControls';

function App(): JSX.Element {
  const { view, pending, runGuarded, registerGuard } = useWorkspaceNavigation();
  const appearanceScope = view.kind === 'editor' ? 'editor' : 'workspace';
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [workspaceGeneration, setWorkspaceGeneration] = useState(0);
  const [editorPositions, setEditorPositions] = useState<Record<string, string | null>>({});
  const scope = view.cloudId ?? 'local';
  const rememberEditorPosition = useCallback(
    (fileId: number, segmentId: string | null) => {
      setEditorPositions((positions) => ({ ...positions, [`${scope}:${fileId}`]: segmentId }));
    },
    [scope],
  );
  const updates = useAppUpdates();
  const { status: cloudStatus, refresh: refreshStatus } = useCloudStatus();
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

  const confirmKeepLocal = useCallback(async () => {
    const latest = await window.api.cloudStatus?.();
    if (!latest?.project?.pending) return true;
    return feedbackService.confirm({
      title: 'Keep changes on this device?',
      message:
        'Your changes have not been saved to cloud. They will remain on this device. To continue them on another computer, stay here and save to cloud first.',
      confirmLabel: 'Keep on this device',
      cancelLabel: 'Stay in project',
    });
  }, []);
  const closeCloud = useCallback(
    (closeWindow = false) => {
      void runGuarded(async () => {
        if (!(await confirmKeepLocal())) return null;
        await window.api.cloudCloseProject(true, closeWindow);
        await refreshStatus();
        return { kind: 'home' };
      });
    },
    [runGuarded, confirmKeepLocal, refreshStatus],
  );
  useEffect(() => window.api.onCloudCloseRequested?.(() => closeCloud(true)), [closeCloud]);

  const navigate = (next: WorkspaceView) =>
    runGuarded(async () => {
      const current = await window.api.cloudStatus?.();
      if (current?.project) {
        if (next.kind === 'tm' || next.kind === 'tb')
          next = { ...next, cloudId: current.project.id };
        if (next.cloudId !== current.project.id) {
          if (!(await confirmKeepLocal())) return null;
          await window.api.cloudCloseProject(true);
          await refreshStatus();
        }
      }
      return next;
    });
  const openCloud = (id: string) =>
    runGuarded(async () => {
      if (cloudStatus?.project?.id !== id && !(await confirmKeepLocal())) return null;
      const projectId = await window.api.cloudOpenProject(id, true);
      await refreshStatus();
      return { kind: 'project', projectId, cloudId: id };
    });
  const cloudAction = (action: 'save' | 'pull') => {
    void runGuarded(async () => {
      try {
        if (action === 'save') await window.api.cloudSync();
        else {
          const projectId = await window.api.cloudPull();
          await refreshStatus();
          setWorkspaceGeneration((value) => value + 1);
          feedbackService.success('Latest cloud version is ready.');
          return { kind: 'project', projectId, cloudId: view.cloudId };
        }
        await refreshStatus();
        void refreshCloudProjects();
        feedbackService.success('Saved to cloud. You can continue on another device.');
      } catch (error) {
        await refreshStatus();
        feedbackService.error(error instanceof Error ? error.message : 'Cloud operation failed');
      }
      return view;
    });
  };

  const { projects, loading, createProject, deleteProject } = useProjects();
  const aiFileJobTracker = useAIFileJobTracker();
  const handleCreateProject = async (
    name: string,
    srcLang: string,
    tgtLang: string,
    projectType: ProjectType,
    storage: 'local' | 'cloud',
  ) => {
    await runGuarded(async () => {
      if (!(await confirmKeepLocal())) return null;
      if (storage === 'cloud') {
        const project = await window.api.cloudCreateProject(name, srcLang, tgtLang, projectType);
        await refreshCloudProjects();
        setIsCreateOpen(false);
        const projectId = await window.api.cloudOpenProject(project.id, true);
        await refreshStatus();
        return { kind: 'project', projectId, cloudId: project.id };
      }
      await window.api.cloudCloseProject?.(true);
      await refreshStatus();
      const newProject = await createProject(name, srcLang, tgtLang, projectType);
      if (!newProject?.id) return { kind: 'home' };
      setIsCreateOpen(false);
      return { kind: 'project', projectId: newProject.id };
    });
  };
  const handleDeleteProject = (project: Project) => {
    if (!project.id) return;
    void runGuarded(async () => {
      // Local catalog actions must not be routed through a cloud cache.
      if (cloudStatus?.project) {
        if (!(await confirmKeepLocal())) return null;
        await window.api.cloudCloseProject(true);
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
            onRefreshCloud={
              cloudStatus?.account
                ? () => {
                    void refreshCloudProjects();
                  }
                : undefined
            }
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
            {cloudStatus?.project && (
              <CloudBanner
                status={cloudStatus}
                onClose={() => closeCloud()}
                onSave={() => cloudAction('save')}
                onPull={() => cloudAction('pull')}
              />
            )}
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
                />
              )}
              {view.kind === 'tm' && <TMManager />}
              {view.kind === 'tb' && <TBManager />}
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
