import type { ProjectQASettings, ProjectType } from '@cat/core/project';
import type { MountedTM, ProjectFileRecord, TMCommitScope } from '../../../../shared/ipc';
import type { useProjectFileImport } from '../../hooks/projectDetail/useProjectFileImport';
import { ColumnSelector } from '../ColumnSelector';
import { PasteSourceModal } from './PasteSourceModal';
import { ProjectCommitModal } from './ProjectCommitModal';
import { ProjectMatchModal } from './ProjectMatchModal';
import { ProjectQASettingsModal } from './ProjectQASettingsModal';
import { ProjectReferenceActionsModal } from './ProjectReferenceActionsModal';
import { ProjectReferenceOperationProgressModal } from './ProjectReferenceOperationProgressModal';
import type { useProjectReferenceActions } from './useProjectReferenceActions';

interface ProjectDetailDialogsProps {
  fileImport: ReturnType<typeof useProjectFileImport>;
  projectType: ProjectType;
  mountedTMs: MountedTM[];
  commitFile: ProjectFileRecord | null;
  commitTmId: string;
  commitScope: TMCommitScope;
  onCommitTmIdChange: (tmId: string) => void;
  onCommitScopeChange: (scope: TMCommitScope) => void;
  onCancelCommit: () => void;
  onConfirmCommit: () => void;
  matchFile: ProjectFileRecord | null;
  matchTmId: string;
  onMatchTmIdChange: (tmId: string) => void;
  onCancelMatch: () => void;
  onConfirmMatch: () => void;
  referenceActions: ReturnType<typeof useProjectReferenceActions>;
  qaSettingsOpen: boolean;
  qaSettingsDraft: ProjectQASettings;
  qaSettingsSaving: boolean;
  onQASettingsChange: (settings: ProjectQASettings) => void;
  onCloseQASettings: () => void;
  onSaveQASettings: () => void;
}

export function ProjectDetailDialogs({
  fileImport,
  projectType,
  mountedTMs,
  commitFile,
  commitTmId,
  commitScope,
  onCommitTmIdChange,
  onCommitScopeChange,
  onCancelCommit,
  onConfirmCommit,
  matchFile,
  matchTmId,
  onMatchTmIdChange,
  onCancelMatch,
  onConfirmMatch,
  referenceActions,
  qaSettingsOpen,
  qaSettingsDraft,
  qaSettingsSaving,
  onQASettingsChange,
  onCloseQASettings,
  onSaveQASettings,
}: ProjectDetailDialogsProps) {
  return (
    <>
      <ColumnSelector
        isOpen={fileImport.isSelectorOpen}
        onClose={fileImport.closeSelector}
        onConfirm={fileImport.confirmImport}
        previewData={fileImport.previewData}
        projectType={projectType}
      />
      <PasteSourceModal
        open={fileImport.isPasteSourceOpen}
        clipboard={fileImport.pasteClipboard}
        creating={fileImport.pasteCreating}
        onClose={fileImport.closePasteSource}
        onCreate={(input) => void fileImport.confirmPasteSource(input)}
      />
      <ProjectCommitModal
        file={commitFile}
        mountedTMs={mountedTMs}
        selectedTmId={commitTmId}
        commitScope={commitScope}
        onSelectedTmIdChange={onCommitTmIdChange}
        onCommitScopeChange={onCommitScopeChange}
        onCancel={onCancelCommit}
        onConfirm={onConfirmCommit}
      />
      <ProjectMatchModal
        file={matchFile}
        mountedTMs={mountedTMs}
        selectedTmId={matchTmId}
        onSelectedTmIdChange={onMatchTmIdChange}
        onCancel={onCancelMatch}
        onConfirm={onConfirmMatch}
      />
      <ProjectReferenceActionsModal
        file={referenceActions.file}
        onClose={referenceActions.close}
        onPrecheckSourceTerms={referenceActions.precheckSourceTerms}
        onExportReferences={referenceActions.exportReferences}
      />
      <ProjectQASettingsModal
        isOpen={qaSettingsOpen}
        draft={qaSettingsDraft}
        onChange={onQASettingsChange}
        onClose={onCloseQASettings}
        onSave={onSaveQASettings}
        saving={qaSettingsSaving}
      />
      <ProjectReferenceOperationProgressModal
        progress={referenceActions.progress}
        onCancelPrecheck={referenceActions.cancelPrecheck}
      />
    </>
  );
}
