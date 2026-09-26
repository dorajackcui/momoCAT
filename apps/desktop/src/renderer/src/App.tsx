import { Button } from './components/ui';
import React, { useCallback, useState } from 'react';
import type { Project, ProjectType } from '@cat/core/project';
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
import { useAppUpdates } from './hooks/useAppUpdates';
import { useWorkspaceNavigation } from './hooks/useWorkspaceNavigation';
import { ThemeProvider } from './theme/ThemeProvider';
import { TypographyProvider } from './theme/TypographyProvider';

function App(): JSX.Element {
  const { view, pending, navigate, runGuarded, registerGuard } = useWorkspaceNavigation();
  const appearanceScope = view.kind === 'editor' ? 'editor' : 'workspace';
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editorPositions, setEditorPositions] = useState<Record<number, string | null>>({});
  const rememberEditorPosition = useCallback((fileId: number, segmentId: string | null) => {
    setEditorPositions((positions) => ({ ...positions, [fileId]: segmentId }));
  }, []);
  const updates = useAppUpdates();

  const { projects, loading, createProject, deleteProject } = useProjects();
  const aiFileJobTracker = useAIFileJobTracker();

  const handleCreateProject = async (
    name: string,
    srcLang: string,
    tgtLang: string,
    projectType: ProjectType,
  ) => {
    await runGuarded(async () => {
      const newProject = await createProject(name, srcLang, tgtLang, projectType);
      if (!newProject?.id) return null;
      setIsCreateOpen(false);
      return { kind: 'project', projectId: newProject.id };
    });
  };

  const handleDeleteProject = (project: Project) => {
    if (!project.id) return;
    void runGuarded(async () => {
      const deleted = await deleteProject(project.id!, project.name);
      if (!deleted) return null;
      return 'projectId' in view && view.projectId === project.id ? { kind: 'home' } : view;
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
            view={view}
            disabled={pending || loading}
            onNavigate={(next) => {
              void navigate(next);
            }}
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
              loading={loading || pending}
            />
          )}
          <main
            className="workspace-main"
            aria-label="Workspace"
            aria-busy={pending}
            ref={(element) => {
              // Prevent new edits while the navigation guard drains pending writes.
              if (element) element.inert = pending;
            }}
          >
            <ErrorBoundary
              key={
                view.kind === 'editor'
                  ? `editor:${view.fileId}`
                  : view.kind === 'project'
                    ? `project:${view.projectId}`
                    : view.kind
              }
            >
              {view.kind === 'home' && (
                <section className="workspace-home">
                  <div className="workspace-home-content">
                    <span className="text-sm text-text-muted">MomoCAT workspace</span>
                    <h1 className="mt-3 text-3xl font-semibold tracking-tight">Projects</h1>
                    <p className="mt-3 text-sm leading-6 text-text-muted">
                      {projects.length
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
                    void navigate({ kind: 'editor', projectId: view.projectId, fileId });
                  }}
                  aiFileJobTracker={aiFileJobTracker}
                />
              )}
              {view.kind === 'editor' && (
                <Editor
                  fileId={view.fileId}
                  onBack={() => {
                    void navigate({ kind: 'project', projectId: view.projectId });
                  }}
                  aiFileJobTracker={aiFileJobTracker}
                  registerNavigationGuard={registerGuard}
                  initialActiveSegmentId={editorPositions[view.fileId]}
                  onRememberPosition={rememberEditorPosition}
                />
              )}
              {view.kind === 'tm' && <TMManager />}
              {view.kind === 'tb' && <TBManager />}
              {view.kind === 'settings' && <SettingsPage updates={updates} />}
            </ErrorBoundary>
          </main>
        </div>
      </TypographyProvider>
    </ThemeProvider>
  );
}

export default App;
