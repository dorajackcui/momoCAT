import { useCallback, useState, useSyncExternalStore } from 'react';
import type { ProjectType } from '@cat/core/project';
import type { ProjectFileRecord } from '../../../../shared/ipc';
import { ProjectAIController } from '../../hooks/projectDetail/useProjectAI';
import type { TrackedAIJob } from '../../hooks/projectDetail/ai/types';
import { AssetNameEditor } from '../AssetNameEditor';
import { Button, Card, Icon, IconButton } from '../ui';
import { ProjectAITranslateModal, type ProjectAITranslateSubmit } from './ProjectAITranslateModal';
import { deriveFileProgressBuckets, toPercent } from './fileProgressStats';

interface ProjectFilesPaneProps {
  files: ProjectFileRecord[];
  onOpenFile: (fileId: number) => void;
  onOpenCommitModal: (file: ProjectFileRecord) => void | Promise<void>;
  onOpenMatchModal: (file: ProjectFileRecord) => void | Promise<void>;
  onOpenReferenceActions: (file: ProjectFileRecord) => void;
  onRenameFile: (fileId: number, name: string) => Promise<void>;
  onDeleteFile: (fileId: number, fileName: string) => Promise<void>;
  onExportFile: (fileId: number, fileName: string) => Promise<void>;
  onRunFileQA: (fileId: number, fileName: string) => Promise<void>;
  ai: ProjectAIController;
  projectType?: ProjectType;
  onOpenAISettings: () => void;
}

export function buildProjectAITranslateStartOptions(options: ProjectAITranslateSubmit) {
  return {
    targetBaseline: options.targetBaseline,
    confirm: false,
  };
}

// Subscribe per file card so AI job progress events only re-render the card
// of the file being translated instead of the whole project detail tree.
function useTrackedFileJob(ai: ProjectAIController, fileId: number): TrackedAIJob | null {
  const getSnapshot = useCallback(() => ai.getFileJob(fileId), [ai, fileId]);
  return useSyncExternalStore(ai.subscribeFileJobs, getSnapshot, getSnapshot);
}

interface ProjectFileCardProps {
  file: ProjectFileRecord;
  ai: ProjectAIController;
  onOpenFile: (fileId: number) => void;
  onOpenCommitModal: (file: ProjectFileRecord) => void | Promise<void>;
  onOpenMatchModal: (file: ProjectFileRecord) => void | Promise<void>;
  onOpenReferenceActions: (file: ProjectFileRecord) => void;
  onRenameFile: (fileId: number, name: string) => Promise<void>;
  onDeleteFile: (fileId: number, fileName: string) => Promise<void>;
  onExportFile: (fileId: number, fileName: string) => Promise<void>;
  onRunFileQA: (fileId: number, fileName: string) => Promise<void>;
  onRequestAITranslate: (file: ProjectFileRecord) => void;
  supportsTMWorkflow: boolean;
  isCustomProject: boolean;
}

function ProjectFileCard({
  file,
  ai,
  onOpenFile,
  onOpenCommitModal,
  onOpenMatchModal,
  onOpenReferenceActions,
  onRenameFile,
  onDeleteFile,
  onExportFile,
  onRunFileQA,
  onRequestAITranslate,
  supportsTMWorkflow,
  isCustomProject,
}: ProjectFileCardProps) {
  const extensionIndex = file.name.lastIndexOf('.');
  const editableName = extensionIndex > 0 ? file.name.slice(0, extensionIndex) : file.name;
  const extension = extensionIndex > 0 ? file.name.slice(extensionIndex) : '';
  const progressBuckets = deriveFileProgressBuckets(file);
  const progress = toPercent(progressBuckets);
  const job = useTrackedFileJob(ai, file.id);
  const jobRunning = job?.status === 'running';
  const jobStopping = jobRunning && job.cancelRequested === true;
  const jobProgressColor =
    job?.status === 'failed'
      ? 'bg-danger'
      : job?.status === 'cancelled'
        ? 'bg-warning'
        : 'bg-brand-solid';
  const jobMessage =
    job?.message ||
    (job?.status === 'completed'
      ? 'Completed'
      : job?.status === 'cancelled'
        ? 'Cancelled. Partial results kept.'
        : 'In progress');

  return (
    <div
      className="workspace-task-row group"
      onClick={(event) => {
        // Title and action controls handle their own clicks; only row space opens the file.
        if (
          event.target instanceof Element &&
          event.target.closest('button, input, select, textarea, a, form')
        )
          return;
        onOpenFile(file.id);
      }}
    >
      <div className="min-w-0 flex-1">
        <AssetNameEditor
          name={editableName}
          suffix={extension}
          leadingIcon={
            <Icon name="file-spreadsheet" className="h-4 w-4 shrink-0 text-text-muted" />
          }
          headingLevel="h4"
          assetLabel="file"
          onOpen={() => onOpenFile(file.id)}
          onRename={(name) => onRenameFile(file.id, `${name}${extension}`)}
        />
        <div className="workspace-task-details">
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <div
              className="w-16 h-1 bg-muted rounded-full overflow-hidden"
              role="progressbar"
              aria-label="Confirmed segments"
              aria-valuenow={progressBuckets.confirmedSegmentsForBar}
              aria-valuemin={0}
              aria-valuemax={progressBuckets.totalSegments}
            >
              <div className="h-full bg-success" style={{ width: `${progress.confirmedPct}%` }} />
            </div>
            <span className="text-2xs text-text-faint tabular-nums">
              {progressBuckets.confirmedSegmentsForBar} / {progressBuckets.totalSegments}
            </span>
            {progressBuckets.qaProblemSegments > 0 && (
              <span
                className="inline-flex items-center gap-1 text-2xs text-warning"
                aria-label={`${progressBuckets.qaProblemSegments} segments with QA issues`}
                title="Segments with QA issues"
              >
                <svg
                  aria-hidden="true"
                  className="h-3 w-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m12 3 10 18H2L12 3Zm0 5v5m0 4h.01" />
                </svg>
                {progressBuckets.qaProblemSegments}
              </span>
            )}
          </div>
          {job && (
            <div className="mt-2 w-48 max-w-full">
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${jobProgressColor}`}
                  style={{ width: `${job.progress || 0}%` }}
                />
              </div>
              <div className="text-caption text-text-faint mt-1">{jobMessage}</div>
            </div>
          )}
        </div>
      </div>
      <div className="workspace-task-actions">
        {supportsTMWorkflow && (
          <Button onClick={() => void onOpenMatchModal(file)} variant="ghost" size="sm">
            Match
          </Button>
        )}
        {supportsTMWorkflow && (
          <Button onClick={() => onOpenReferenceActions(file)} variant="ghost" size="sm">
            TM/TB
          </Button>
        )}
        {supportsTMWorkflow ? (
          <Button
            onClick={() =>
              jobRunning ? void ai.cancelAITranslateFile(file.id) : onRequestAITranslate(file)
            }
            disabled={jobStopping}
            variant={jobRunning ? 'primary' : 'secondary'}
            tone={jobRunning ? 'danger' : undefined}
            size="sm"
          >
            {jobRunning ? (jobStopping ? 'Stopping...' : 'Stop') : 'Translate'}
          </Button>
        ) : (
          <Button
            onClick={() =>
              jobRunning
                ? void ai.cancelAITranslateFile(file.id)
                : void ai.startAITranslateFile(file.id, file.name)
            }
            disabled={jobStopping}
            variant={jobRunning ? 'primary' : 'secondary'}
            tone={jobRunning ? 'danger' : undefined}
            size="sm"
          >
            {jobRunning
              ? jobStopping
                ? 'Stopping...'
                : 'Stop'
              : isCustomProject
                ? 'AI Process'
                : 'AI Translate'}
          </Button>
        )}
        {supportsTMWorkflow && (
          <Button onClick={() => void onRunFileQA(file.id, file.name)} variant="ghost" size="sm">
            QA
          </Button>
        )}
        {supportsTMWorkflow && (
          <Button onClick={() => void onOpenCommitModal(file)} variant="ghost" size="sm">
            Commit
          </Button>
        )}
        <IconButton
          onClick={() => void onExportFile(file.id, file.name)}
          variant="ghost"
          size="sm"
          title="Export File"
          aria-label="Export File"
        >
          <svg
            aria-hidden="true"
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
        </IconButton>
        <IconButton
          onClick={() => void onDeleteFile(file.id, file.name)}
          variant="ghost"
          tone="danger"
          size="sm"
          title="Delete File"
          aria-label="Delete File"
        >
          <svg
            aria-hidden="true"
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </IconButton>
      </div>
    </div>
  );
}

export function ProjectFilesPane({
  files,
  onOpenFile,
  onOpenCommitModal,
  onOpenMatchModal,
  onOpenReferenceActions,
  onRenameFile,
  onDeleteFile,
  onExportFile,
  onRunFileQA,
  ai,
  projectType = 'translation',
  onOpenAISettings,
}: ProjectFilesPaneProps) {
  const [aiTranslateFile, setAiTranslateFile] = useState<{ id: number; name: string } | null>(null);
  const isCustomProject = projectType === 'custom';
  const supportsTMWorkflow = projectType === 'translation';
  const handleRequestAITranslate = useCallback((file: ProjectFileRecord) => {
    setAiTranslateFile({ id: file.id, name: file.name });
  }, []);

  return (
    <div className="w-full max-w-6xl">
      {(ai.providerSetupRequired || ai.providerUnavailable) && (
        <div className="mb-4 flex items-center gap-2 text-xs text-text-muted">
          <span>
            {ai.providerSetupRequired ? 'AI provider not configured.' : 'AI provider unavailable.'}
          </span>
          <Button variant="link" onClick={onOpenAISettings}>
            Open settings
          </Button>
        </div>
      )}
      {aiTranslateFile && (
        <ProjectAITranslateModal
          projectType={projectType}
          open={true}
          fileName={aiTranslateFile.name}
          onClose={() => setAiTranslateFile(null)}
          onConfirm={(options) => {
            void ai.startAITranslateFile(
              aiTranslateFile.id,
              aiTranslateFile.name,
              buildProjectAITranslateStartOptions(options),
            );
            setAiTranslateFile(null);
          }}
        />
      )}

      <h3 className="text-sm font-semibold text-text mb-3">
        Tasks <span className="ml-2 font-normal text-text-faint">{files.length}</span>
      </h3>

      {files.length === 0 ? (
        <Card variant="subtle" className="text-center py-20 border-2 border-dashed">
          <p className="text-text-muted">
            No files added yet. Click &quot;+ Add File&quot; to start.
          </p>
        </Card>
      ) : (
        <div className="workspace-task-list">
          {files.map((file) => (
            <ProjectFileCard
              key={file.id}
              file={file}
              ai={ai}
              onOpenFile={onOpenFile}
              onOpenCommitModal={onOpenCommitModal}
              onOpenMatchModal={onOpenMatchModal}
              onOpenReferenceActions={onOpenReferenceActions}
              onRenameFile={onRenameFile}
              onDeleteFile={onDeleteFile}
              onExportFile={onExportFile}
              onRunFileQA={onRunFileQA}
              onRequestAITranslate={handleRequestAITranslate}
              supportsTMWorkflow={supportsTMWorkflow}
              isCustomProject={isCustomProject}
            />
          ))}
        </div>
      )}
    </div>
  );
}
