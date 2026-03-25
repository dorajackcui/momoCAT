import React, { useState } from 'react';
import type { ProjectType } from '@cat/core/project';
import { Dashboard } from './components/Dashboard';
import { ProjectDetail } from './components/ProjectDetail';
import { Editor } from './components/Editor';
import { TMManager } from './components/TMManager';
import { TBManager } from './components/TBManager';
import { SettingsModal } from './components/SettingsModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useProjects } from './hooks/useProjects';

type View = 'dashboard' | 'projectDetail' | 'editor' | 'tms' | 'tbs';

function App(): JSX.Element {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [activeFileId, setActiveFileId] = useState<number | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const { projects, loading, loadProjects, createProject, deleteProject } = useProjects();

  const handleOpenProject = (id: number) => {
    setActiveProjectId(id);
    setCurrentView('projectDetail');
  };

  const handleOpenFile = (id: number) => {
    setActiveFileId(id);
    setCurrentView('editor');
  };

  const handleBackToDashboard = () => {
    setCurrentView('dashboard');
    setActiveProjectId(null);
    setActiveFileId(null);
    loadProjects();
  };

  const handleBackToProject = () => {
    setCurrentView('projectDetail');
    setActiveFileId(null);
  };

  const handleCreateProject = async (
    name: string,
    srcLang: string,
    tgtLang: string,
    projectType: ProjectType,
  ) => {
    const newProject = await createProject(name, srcLang, tgtLang, projectType);
    if (newProject && newProject.id) {
      handleOpenProject(newProject.id);
    }
  };

  if (currentView === 'editor' && activeFileId !== null) {
    return (
      <ErrorBoundary>
        <Editor fileId={activeFileId} onBack={handleBackToProject} />
      </ErrorBoundary>
    );
  }

  if (currentView === 'projectDetail' && activeProjectId !== null) {
    return (
      <ErrorBoundary>
        <ProjectDetail
          projectId={activeProjectId}
          onBack={handleBackToDashboard}
          onOpenFile={handleOpenFile}
        />
      </ErrorBoundary>
    );
  }

  return (
    <div className="app-shell">
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <header className="app-topbar">
        <div className="flex items-center gap-3 cursor-pointer" onClick={handleBackToDashboard}>
          <div className="w-8 h-8 bg-brand rounded-control flex items-center justify-center text-brand-contrast font-bold shadow-panel">
            C
          </div>
          <h1 className="text-xl font-bold tracking-tight text-text">
            MomoCAT<span className="text-xs font-medium text-brand ml-1">v0.2</span>
          </h1>
        </div>
        <nav className="flex gap-2 items-center">
          <button
            onClick={() => setCurrentView('dashboard')}
            className={currentView === 'dashboard' ? 'nav-pill nav-pill-active' : 'nav-pill'}
          >
            Projects
          </button>
          <button
            onClick={() => setCurrentView('tms')}
            className={currentView === 'tms' ? 'nav-pill nav-pill-active' : 'nav-pill'}
          >
            TM
          </button>
          <button
            onClick={() => setCurrentView('tbs')}
            className={currentView === 'tbs' ? 'nav-pill nav-pill-active' : 'nav-pill'}
          >
            TB
          </button>
          <div className="h-6 w-[1px] bg-border" />
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="btn-secondary !px-3 !py-1.5"
            title="AI & Network Settings"
          >
            Settings
          </button>
        </nav>
      </header>

      <main className="flex-1 overflow-hidden flex">
        {currentView === 'dashboard' ? (
          <Dashboard
            projects={projects}
            loading={loading}
            onOpenProject={handleOpenProject}
            onCreateProject={handleCreateProject}
            onDeleteProject={deleteProject}
          />
        ) : currentView === 'tms' ? (
          <TMManager />
        ) : (
          <TBManager />
        )}
      </main>

      <footer className="app-footer">
        <span>Ready</span>
        <span>Offline Mode • Spreadsheet-first v0.1</span>
      </footer>
    </div>
  );
}

export default App;
