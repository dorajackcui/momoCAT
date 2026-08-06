import React, { useEffect, useRef, useState } from 'react';
import type { ProjectType } from '@cat/core/project';
import { Dashboard } from './components/Dashboard';
import { ProjectDetail } from './components/ProjectDetail';
import { Editor } from './components/Editor';
import { TMManager } from './components/TMManager';
import { TBManager } from './components/TBManager';
import { SettingsModal } from './components/SettingsModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAIFileJobTracker } from './hooks/aiFileJobs';
import { useProjects } from './hooks/useProjects';
import { FeedbackHost } from './services/FeedbackHost';
import { feedbackService } from './services/feedbackService';

type View = 'dashboard' | 'projectDetail' | 'editor' | 'tms' | 'tbs';

function App(): JSX.Element {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [activeFileId, setActiveFileId] = useState<number | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [updateStatusMessage, setUpdateStatusMessage] = useState('Check for updates');
  const [isUpdateBusy, setIsUpdateBusy] = useState(false);
  const manualUpdateCheckRef = useRef(false);
  const progressToastBucketRef = useRef<number | null>(null);

  const { projects, loading, loadProjects, createProject, deleteProject } = useProjects();
  const aiFileJobTracker = useAIFileJobTracker();

  useEffect(() => {
    const unsubscribe = window.api.onAppUpdateStatus((status) => {
      setUpdateStatusMessage(status.message);
      setIsUpdateBusy(
        status.phase === 'checking' ||
          status.phase === 'available' ||
          status.phase === 'downloading',
      );

      const shouldToast = manualUpdateCheckRef.current;
      if (status.phase === 'checking') {
        progressToastBucketRef.current = null;
        if (shouldToast) feedbackService.info(status.message);
        return;
      }

      if (status.phase === 'available') {
        if (shouldToast) feedbackService.info(status.message);
        return;
      }

      if (status.phase === 'downloading') {
        const percent = status.percent;
        if (shouldToast && percent !== undefined) {
          const bucket = Math.floor(percent / 25);
          if (progressToastBucketRef.current !== bucket) {
            progressToastBucketRef.current = bucket;
            feedbackService.info(status.message);
          }
        }
        return;
      }

      progressToastBucketRef.current = null;
      manualUpdateCheckRef.current = false;
      if (status.phase === 'downloaded') {
        feedbackService.success(status.message);
        return;
      }
      if (status.phase === 'error') {
        feedbackService.error(status.message);
        return;
      }
      if (shouldToast) {
        feedbackService.info(status.message);
      }
    });

    return unsubscribe;
  }, []);

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

  const handleCheckForUpdates = async () => {
    manualUpdateCheckRef.current = true;
    progressToastBucketRef.current = null;
    setIsUpdateBusy(true);
    setUpdateStatusMessage('Checking for updates...');

    try {
      await window.api.checkForUpdates();
    } catch (error) {
      manualUpdateCheckRef.current = false;
      setIsUpdateBusy(false);
      setUpdateStatusMessage('Check for updates');
      feedbackService.error('Failed to start update check.');
      console.error('[Updates] Failed to start update check:', error);
    }
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

  const withFeedbackHost = (children: React.ReactNode) => (
    <>
      <FeedbackHost />
      {children}
    </>
  );

  if (currentView === 'editor' && activeFileId !== null) {
    return withFeedbackHost(
      <ErrorBoundary>
        <Editor
          fileId={activeFileId}
          onBack={handleBackToProject}
          aiFileJobTracker={aiFileJobTracker}
        />
      </ErrorBoundary>,
    );
  }

  if (currentView === 'projectDetail' && activeProjectId !== null) {
    return withFeedbackHost(
      <ErrorBoundary>
        <ProjectDetail
          projectId={activeProjectId}
          onBack={handleBackToDashboard}
          onOpenFile={handleOpenFile}
          aiFileJobTracker={aiFileJobTracker}
        />
      </ErrorBoundary>,
    );
  }

  return withFeedbackHost(
    <div className="app-shell">
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <header className="app-topbar">
        <div className="flex items-center gap-3 cursor-pointer" onClick={handleBackToDashboard}>
          <div className="w-8 h-8 bg-brand rounded-control flex items-center justify-center text-brand-contrast font-bold shadow-panel">
            C
          </div>
          <h1 className="text-xl font-bold tracking-tight text-text">
            MomoCAT<span className="text-xs font-medium text-brand ml-1">v1.0.9</span>
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
            title="Settings"
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
        <button
          type="button"
          onClick={handleCheckForUpdates}
          disabled={isUpdateBusy}
          className="text-text-muted hover:text-brand disabled:cursor-default disabled:opacity-80"
          title="Check for momoCAT updates"
        >
          {updateStatusMessage}
        </button>
      </footer>
    </div>,
  );
}

export default App;
