import { useEffect, useState } from 'react';
import { DEFAULT_PROJECT_QA_SETTINGS, type ProjectQASettings } from '@cat/core/project';
import type { ProjectFileRecord, TMCommitScope } from '../../../shared/ipc';
import { apiClient } from '../services/apiClient';
import { feedbackService } from '../services/feedbackService';
import type { AIFileJobTracker } from '../hooks/aiFileJobs';
import { useProjectDetailData } from '../hooks/projectDetail/useProjectDetailData';
import { useProjectFileImport } from '../hooks/projectDetail/useProjectFileImport';
import { useProjectAI } from '../hooks/projectDetail/useProjectAI';
import { ProjectDetailDialogs } from './project-detail/ProjectDetailDialogs';
import { ProjectDetailHeader, type ProjectDetailTab } from './project-detail/ProjectDetailHeader';
import { ProjectFilesPane } from './project-detail/ProjectFilesPane';
import { ProjectTMPane } from './project-detail/ProjectTMPane';
import { ProjectTBPane } from './project-detail/ProjectTBPane';
import { runFileQaWithRefresh } from './project-detail/runFileQaWithRefresh';
import { buildFileQaFeedback } from './project-detail/fileQaFeedback';
import { useProjectReferenceActions } from './project-detail/useProjectReferenceActions';
import { hasMatchingLanguagePair } from './languageOptions';
import { createProjectWorkingTMActions } from './project-detail/workingTMActions';
import { getDefaultMountedCommitTarget } from './project-detail/ProjectCommitModal';

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
  const [activeTab, setActiveTab] = useState<ProjectDetailTab>('files');
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
  const [aiSettingsExpanded, setAISettingsExpanded] = useState(false);

  const {
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
    mountTM,
    unmountTM,
    mountTB,
    unmountTB,
    commitToMainTM,
    matchFileWithTM,
  } = useProjectDetailData(projectId);
  const referenceActions = useProjectReferenceActions(runMutation);

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
  const workingTMActions = project
    ? createProjectWorkingTMActions({
        projectId,
        projectName: project.name,
        api: apiClient,
        feedback: feedbackService,
        reload: loadTMData,
        runMutation,
      })
    : null;

  useEffect(() => {
    if (activeTab === 'tm') {
      void loadTMData();
      return;
    }

    if (activeTab === 'tb') {
      void loadTBData();
    }
  }, [activeTab, loadTBData, loadTMData]);

  const openCommitModal = async (file: ProjectFileRecord) => {
    const currentMountedTMs = await loadMountedTMs();
    const defaultTarget = getDefaultMountedCommitTarget(currentMountedTMs);
    if (!defaultTarget) {
      feedbackService.info('No writable Working TM or mounted Main TM found.');
      return;
    }
    setCommitModalFile(file);
    setCommitTmId(defaultTarget.id);
    setCommitScope('confirmed-only');
  };

  const confirmCommitModal = async () => {
    if (!commitModalFile || !commitTmId) return;
    try {
      const count = await commitToMainTM(commitTmId, commitModalFile.id, { scope: commitScope });
      const committedLabel = commitScope === 'all' ? 'eligible segments' : 'confirmed segments';
      const target = mountedTMs.find((tm) => tm.id === commitTmId);
      const targetLabel = target?.type === 'working' ? 'Working TM' : 'Main TM';
      feedbackService.success(
        `Successfully committed ${count} ${committedLabel} to ${targetLabel}.`,
      );
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

  const handleRenameFile = async (fileId: number, name: string) => {
    try {
      const result = await apiClient.renameFile(fileId, name);
      setFiles((current) =>
        current.map((file) => (file.id === fileId ? { ...file, name: result.name } : file)),
      );
      if (result.internalFile === 'missing') {
        feedbackService.info(
          'File renamed, but its internal source file is missing. Export and inspect remain unavailable for this file.',
        );
      }
    } catch (error) {
      feedbackService.error(
        `Failed to rename file: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
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
      <ProjectDetailDialogs
        fileImport={fileImport}
        projectType={project?.projectType || 'translation'}
        mountedTMs={mountedTMs}
        commitFile={commitModalFile}
        commitTmId={commitTmId}
        commitScope={commitScope}
        onCommitTmIdChange={setCommitTmId}
        onCommitScopeChange={setCommitScope}
        onCancelCommit={() => {
          setCommitModalFile(null);
          setCommitTmId('');
          setCommitScope('confirmed-only');
        }}
        onConfirmCommit={() => void confirmCommitModal()}
        matchFile={matchModalFile}
        matchTmId={matchTmId}
        onMatchTmIdChange={setMatchTmId}
        onCancelMatch={() => {
          setMatchModalFile(null);
          setMatchTmId('');
        }}
        onConfirmMatch={() => void confirmMatchModal()}
        referenceActions={referenceActions}
        qaSettingsOpen={qaSettingsOpen}
        qaSettingsDraft={qaSettingsDraft}
        qaSettingsSaving={qaSettingsSaving}
        onQASettingsChange={setQaSettingsDraft}
        onCloseQASettings={() => setQaSettingsOpen(false)}
        onSaveQASettings={() => void saveQaSettings()}
      />

      <ProjectDetailHeader
        project={project}
        loading={loading}
        activeTab={activeTab}
        onBack={onBack}
        onTabChange={setActiveTab}
        onOpenQASettings={openQaSettings}
        isAddFileMenuOpen={isAddFileMenuOpen}
        onToggleAddFileMenu={fileImport.toggleAddFileMenu}
        onCloseAddFileMenu={closeAddFileMenu}
        onOpenFileImport={() => void fileImport.openFileImport()}
        onOpenPasteSource={() => void fileImport.openPasteSource()}
      />

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
            onOpenReferenceActions={referenceActions.open}
            onRenameFile={handleRenameFile}
            onDeleteFile={handleDeleteFile}
            onExportFile={handleExportFile}
            onRunFileQA={handleRunFileQA}
            ai={ai}
            projectType={project.projectType || 'translation'}
            aiSettingsExpanded={aiSettingsExpanded}
            onToggleAISettings={() => setAISettingsExpanded((expanded) => !expanded)}
          />
        ) : activeTab === 'tm' ? (
          <ProjectTMPane
            mountedTMs={mountedTMs}
            allMainTMs={allMainTMs.filter((tm) => hasMatchingLanguagePair(tm, project))}
            loadState={tmLoadState}
            onRetry={() => void loadTMData()}
            onMountTM={(tmId) => void handleMountTM(tmId)}
            onUnmountTM={(tmId) => void handleUnmountTM(tmId)}
            onExportWorkingTM={(tm) => void workingTMActions?.export(tm)}
            onResetWorkingTM={(tm) => void workingTMActions?.reset(tm)}
            disabled={loading}
          />
        ) : (
          <ProjectTBPane
            mountedTBs={mountedTBs}
            allTBs={allTBs.filter((tb) => hasMatchingLanguagePair(tb, project))}
            onMountTB={(tbId) => void handleMountTB(tbId)}
            onUnmountTB={(tbId) => void handleUnmountTB(tbId)}
          />
        )}
      </div>
    </div>
  );
}
