import React, { useEffect, useRef, useState } from 'react';
import { DEFAULT_PROJECT_QA_SETTINGS, type ProjectQASettings } from '@cat/core/project';
import type { ProjectFileRecord, TMCommitScope } from '../../../shared/ipc';
import { ColumnSelector } from './ColumnSelector';
import { apiClient } from '../services/apiClient';
import { feedbackService } from '../services/feedbackService';
import type { AIFileJobTracker } from '../hooks/aiFileJobs';
import { useProjectDetailData } from '../hooks/projectDetail/useProjectDetailData';
import { useProjectFileImport } from '../hooks/projectDetail/useProjectFileImport';
import { useProjectAI } from '../hooks/projectDetail/useProjectAI';
import { ProjectCommitModal } from './project-detail/ProjectCommitModal';
import { ProjectMatchModal } from './project-detail/ProjectMatchModal';
import { ProjectFilesPane } from './project-detail/ProjectFilesPane';
import { ProjectTMPane } from './project-detail/ProjectTMPane';
import { ProjectTBPane } from './project-detail/ProjectTBPane';
import { ProjectQASettingsModal } from './project-detail/ProjectQASettingsModal';
import { PasteSourceModal } from './project-detail/PasteSourceModal';
import { runFileQaWithRefresh } from './project-detail/runFileQaWithRefresh';
import { buildFileQaFeedback } from './project-detail/fileQaFeedback';

interface ProjectDetailProps {
  projectId: number;
  onBack: () => void;
  onOpenFile: (fileId: number) => void;
  aiFileJobTracker: AIFileJobTracker;
}

export function ProjectDetail({
  projectId,
  onBack,
  onOpenFile,
  aiFileJobTracker,
}: ProjectDetailProps) {
  const [activeTab, setActiveTab] = useState<'files' | 'tm' | 'tb'>('files');
  const [commitModalFile, setCommitModalFile] = useState<ProjectFileRecord | null>(null);
  const [commitTmId, setCommitTmId] = useState('');
  const [commitScope, setCommitScope] = useState<TMCommitScope>('confirmed-only');
  const [matchModalFile, setMatchModalFile] = useState<ProjectFileRecord | null>(null);
  const [matchTmId, setMatchTmId] = useState('');
  const [qaSettingsOpen, setQaSettingsOpen] = useState(false);
  const [qaSettingsSaving, setQaSettingsSaving] = useState(false);
  const [qaSettingsDraft, setQaSettingsDraft] = useState<ProjectQASettings>(
    DEFAULT_PROJECT_QA_SETTINGS,
  );
  const addFileMenuRef = useRef<HTMLDivElement | null>(null);

  const {
    project,
    setProject,
    files,
    mountedTMs,
    allMainTMs,
    mountedTBs,
    allTBs,
    loading,
    loadData,
    loadMountedTMs,
    loadTMData,
    loadTBData,
    runMutation,
    mountTM,
    unmountTM,
    mountTB,
    unmountTB,
    commitToMainTM,
    matchFileWithTM,
  } = useProjectDetailData(projectId);

  const fileImport = useProjectFileImport({
    projectId,
    loadData,
    runMutation,
  });
  const { closeAddFileMenu, isAddFileMenuOpen } = fileImport;

  const ai = useProjectAI({
    project,
    setProject,
    loadData,
    runMutation,
    fileJobTracker: aiFileJobTracker,
  });

  useEffect(() => {
    if (activeTab === 'tm') {
      void loadTMData();
      return;
    }

    if (activeTab === 'tb') {
      void loadTBData();
    }
  }, [activeTab, loadTBData, loadTMData]);

  useEffect(() => {
    if (!isAddFileMenuOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAddFileMenu();
      }
    };

    const closeOnOutsidePointer = (event: PointerEvent | MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && addFileMenuRef.current?.contains(target)) return;
      closeAddFileMenu();
    };

    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('mousedown', closeOnOutsidePointer);

    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('mousedown', closeOnOutsidePointer);
    };
  }, [closeAddFileMenu, isAddFileMenuOpen]);

  const openCommitModal = async (file: ProjectFileRecord) => {
    const currentMountedTMs = await loadMountedTMs();
    const mountedMainTMs = currentMountedTMs.filter((tm) => tm.type === 'main');
    if (mountedMainTMs.length === 0) {
      feedbackService.info('No mounted Main TM found. Please mount a Main TM first.');
      return;
    }
    setCommitModalFile(file);
    setCommitTmId(mountedMainTMs[0].id);
    setCommitScope('confirmed-only');
  };

  const confirmCommitModal = async () => {
    if (!commitModalFile || !commitTmId) return;
    try {
      const count = await commitToMainTM(commitTmId, commitModalFile.id, { scope: commitScope });
      const committedLabel = commitScope === 'all' ? 'eligible segments' : 'confirmed segments';
      feedbackService.success(`Successfully committed ${count} ${committedLabel} to Main TM.`);
    } catch {
      feedbackService.error('Failed to commit segments');
    } finally {
      setCommitModalFile(null);
      setCommitTmId('');
      setCommitScope('confirmed-only');
    }
  };

  const openMatchModal = async (file: ProjectFileRecord) => {
    const currentMountedTMs = await loadMountedTMs();
    if (currentMountedTMs.length === 0) {
      feedbackService.info('No mounted TM found. Please mount a TM first.');
      return;
    }
    setMatchModalFile(file);
    setMatchTmId(currentMountedTMs[0].id);
  };

  const confirmMatchModal = async () => {
    if (!matchModalFile || !matchTmId) return;
    try {
      const result = await matchFileWithTM(matchModalFile.id, matchTmId);
      feedbackService.success(
        `TM batch matching completed.\nTotal: ${result.total}\nMatched: ${result.matched}\nApplied: ${result.applied}\nSkipped: ${result.skipped}`,
      );
    } catch {
      feedbackService.error('TM matching failed.');
    } finally {
      setMatchModalFile(null);
      setMatchTmId('');
    }
  };

  const handleMountTM = async (tmId: string) => {
    try {
      await mountTM(tmId);
    } catch {
      feedbackService.error('Failed to mount TM');
    }
  };

  const handleUnmountTM = async (tmId: string) => {
    try {
      await unmountTM(tmId);
    } catch {
      feedbackService.error('Failed to unmount TM');
    }
  };

  const handleMountTB = async (tbId: string) => {
    try {
      await mountTB(tbId);
    } catch {
      feedbackService.error('Failed to mount term base');
    }
  };

  const handleUnmountTB = async (tbId: string) => {
    try {
      await unmountTB(tbId);
    } catch {
      feedbackService.error('Failed to unmount term base');
    }
  };

  const handleDeleteFile = async (fileId: number, fileName: string) => {
    const confirmed = await feedbackService.confirm(
      `Are you sure you want to delete "${fileName}"?`,
    );
    if (!confirmed) return;

    try {
      await runMutation(async () => {
        await apiClient.deleteFile(fileId);
        await loadData();
      });
    } catch {
      feedbackService.error('Failed to delete file');
    }
  };

  const handleExportFile = async (fileId: number, fileName: string) => {
    const defaultPath = fileName.replace(/(\.xlsx|\.csv)$/i, '_translated$1');
    const outputPath = await apiClient.saveFileDialog(defaultPath, [
      { name: 'Spreadsheets', extensions: ['xlsx', 'csv'] },
    ]);
    if (!outputPath) return;

    try {
      await runMutation(async () => {
        await apiClient.exportFile(fileId, outputPath);
      });
      feedbackService.success('Export successful');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('Export blocked by QA errors')) {
        feedbackService.error(`Export failed: ${errorMessage}`);
        return;
      }

      const forceExport = await feedbackService.confirm(
        `${errorMessage}\n\nDo you want to force export despite these errors?`,
      );

      if (!forceExport) return;

      try {
        await runMutation(async () => {
          await apiClient.exportFile(fileId, outputPath, undefined, true);
        });
        feedbackService.success('Export successful (forced despite QA errors)');
      } catch (forceError) {
        feedbackService.error(
          `Export failed: ${forceError instanceof Error ? forceError.message : String(forceError)}`,
        );
      }
    }
  };

  const openQaSettings = () => {
    if (!project) return;
    setQaSettingsDraft(project.qaSettings || DEFAULT_PROJECT_QA_SETTINGS);
    setQaSettingsOpen(true);
  };

  const saveQaSettings = async () => {
    if (!project) return;
    setQaSettingsSaving(true);
    try {
      await runMutation(async () => {
        await apiClient.updateProjectQASettings(project.id, qaSettingsDraft);
        await loadData();
      });
      setProject((prev) => (prev ? { ...prev, qaSettings: qaSettingsDraft } : prev));
      setQaSettingsOpen(false);
      feedbackService.success('QA settings updated');
    } catch (error) {
      feedbackService.error(
        `Failed to update QA settings: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setQaSettingsSaving(false);
    }
  };

  const handleRunFileQA = async (fileId: number, fileName: string) => {
    try {
      const report = await runFileQaWithRefresh({
        fileId,
        runMutation,
        runFileQA: (nextFileId: number) => apiClient.runFileQA(nextFileId),
        loadData,
      });
      const feedback = buildFileQaFeedback(fileName, report);
      if (feedback.level === 'success') {
        feedbackService.success(feedback.message);
      } else {
        feedbackService.info(feedback.message);
      }
    } catch (error) {
      feedbackService.error(
        `Run QA failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  return (
    <div className="flex flex-col h-full bg-canvas">
      <ColumnSelector
        isOpen={fileImport.isSelectorOpen}
        onClose={fileImport.closeSelector}
        onConfirm={fileImport.confirmImport}
        previewData={fileImport.previewData}
        projectType={project?.projectType || 'translation'}
      />

      <PasteSourceModal
        open={fileImport.isPasteSourceOpen}
        clipboard={fileImport.pasteClipboard}
        creating={fileImport.pasteCreating}
        onClose={fileImport.closePasteSource}
        onCreate={(input) => void fileImport.confirmPasteSource(input)}
      />

      <ProjectCommitModal
        file={commitModalFile}
        mountedTMs={mountedTMs}
        selectedTmId={commitTmId}
        commitScope={commitScope}
        onSelectedTmIdChange={setCommitTmId}
        onCommitScopeChange={setCommitScope}
        onCancel={() => {
          setCommitModalFile(null);
          setCommitTmId('');
          setCommitScope('confirmed-only');
        }}
        onConfirm={() => void confirmCommitModal()}
      />

      <ProjectMatchModal
        file={matchModalFile}
        mountedTMs={mountedTMs}
        selectedTmId={matchTmId}
        onSelectedTmIdChange={setMatchTmId}
        onCancel={() => {
          setMatchModalFile(null);
          setMatchTmId('');
        }}
        onConfirm={() => void confirmMatchModal()}
      />

      <ProjectQASettingsModal
        isOpen={qaSettingsOpen}
        draft={qaSettingsDraft}
        onChange={setQaSettingsDraft}
        onClose={() => setQaSettingsOpen(false)}
        onSave={() => void saveQaSettings()}
        saving={qaSettingsSaving}
      />

      <div className="px-10 py-4 bg-surface/90 backdrop-blur border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 text-text-faint hover:text-text-muted hover:bg-muted rounded-control transition-colors"
            title="Back to Dashboard"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <div>
            <h2 className="text-xl font-bold text-text">
              {loading ? 'Loading...' : project?.name || 'Project Not Found'}
            </h2>
            {project && (
              <div className="text-xs text-text-muted flex items-center gap-2">
                <span>
                  {project.srcLang} → {project.tgtLang}
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded-control font-semibold ${
                    project.projectType === 'review'
                      ? 'bg-warning-soft/80 text-warning'
                      : project.projectType === 'custom'
                        ? 'bg-success-soft/80 text-success'
                        : 'bg-brand-soft text-brand'
                  }`}
                >
                  {project.projectType === 'review'
                    ? 'Review'
                    : project.projectType === 'custom'
                      ? 'Custom'
                      : 'Translation'}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex surface-subtle p-1">
            <button
              onClick={() => setActiveTab('files')}
              className={`px-4 py-1.5 text-xs font-semibold rounded-control transition-colors ${
                activeTab === 'files'
                  ? 'bg-surface text-brand shadow-panel'
                  : 'text-text-muted hover:text-text hover:bg-surface'
              }`}
            >
              Files
            </button>
            <button
              onClick={() => setActiveTab('tm')}
              className={`px-4 py-1.5 text-xs font-semibold rounded-control transition-colors ${
                activeTab === 'tm'
                  ? 'bg-surface text-brand shadow-panel'
                  : 'text-text-muted hover:text-text hover:bg-surface'
              }`}
            >
              Translation Memory
            </button>
            <button
              onClick={() => setActiveTab('tb')}
              className={`px-4 py-1.5 text-xs font-semibold rounded-control transition-colors ${
                activeTab === 'tb'
                  ? 'bg-surface text-brand shadow-panel'
                  : 'text-text-muted hover:text-text hover:bg-surface'
              }`}
            >
              Term Bases
            </button>
          </div>

          <div className="h-6 w-[1px] bg-border" />

          {project && activeTab === 'files' && (
            <div className="flex items-center gap-2">
              {project.projectType === 'translation' && (
                <button
                  onClick={openQaSettings}
                  disabled={loading}
                  className="btn-secondary !text-warning !bg-warning-soft hover:!bg-warning-soft/80"
                >
                  QA Settings
                </button>
              )}
              <div className="relative" ref={addFileMenuRef}>
                <button
                  onClick={fileImport.toggleAddFileMenu}
                  disabled={loading}
                  className="btn-primary"
                  aria-haspopup="menu"
                  aria-expanded={fileImport.isAddFileMenuOpen}
                >
                  + Add File
                </button>
                {fileImport.isAddFileMenuOpen && (
                  <div
                    className="absolute right-0 mt-2 w-40 surface-card p-1 shadow-float z-20"
                    role="menu"
                  >
                    <button
                      type="button"
                      onClick={() => void fileImport.openFileImport()}
                      className="w-full text-left px-3 py-2 text-sm font-semibold text-text-muted hover:text-text hover:bg-muted rounded-control"
                      role="menuitem"
                    >
                      Import
                    </button>
                    <button
                      type="button"
                      onClick={() => void fileImport.openPasteSource()}
                      className="w-full text-left px-3 py-2 text-sm font-semibold text-text-muted hover:text-text hover:bg-muted rounded-control"
                      role="menuitem"
                    >
                      Paste
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-10 custom-scrollbar">
        {!project ? (
          loading ? (
            <div className="max-w-4xl mx-auto text-center py-20 surface-subtle">
              <p className="text-text-muted">Loading project details...</p>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto text-center py-20 surface-card border-danger/40 bg-danger-soft">
              <p className="text-danger font-medium">
                Error: Project with ID {projectId} could not be found.
              </p>
              <button onClick={onBack} className="mt-4 text-brand font-semibold hover:underline">
                Go back to Dashboard
              </button>
            </div>
          )
        ) : activeTab === 'files' ? (
          <ProjectFilesPane
            files={files}
            onOpenFile={onOpenFile}
            onOpenCommitModal={openCommitModal}
            onOpenMatchModal={openMatchModal}
            onDeleteFile={handleDeleteFile}
            onExportFile={handleExportFile}
            onRunFileQA={handleRunFileQA}
            ai={ai}
            projectType={project.projectType || 'translation'}
          />
        ) : activeTab === 'tm' ? (
          <ProjectTMPane
            mountedTMs={mountedTMs}
            allMainTMs={allMainTMs}
            onMountTM={(tmId) => void handleMountTM(tmId)}
            onUnmountTM={(tmId) => void handleUnmountTM(tmId)}
          />
        ) : (
          <ProjectTBPane
            mountedTBs={mountedTBs}
            allTBs={allTBs}
            onMountTB={(tbId) => void handleMountTB(tbId)}
            onUnmountTB={(tbId) => void handleUnmountTB(tbId)}
          />
        )}
      </div>
    </div>
  );
}
