import { useCallback, useState, useSyncExternalStore } from 'react';
import type { ProjectType } from '@cat/core/project';
import type { ProjectFileRecord } from '../../../../shared/ipc';
import { ProjectAIController } from '../../hooks/projectDetail/useProjectAI';
import type { TrackedAIJob } from '../../hooks/projectDetail/ai/types';
import { Button, Card, IconButton } from '../ui';
import { ProjectAIPane } from './ProjectAIPane';
import { ProjectAITranslateModal, type ProjectAITranslateSubmit } from './ProjectAITranslateModal';
import { deriveFileProgressBuckets, toPercent } from './fileProgressStats';

interface ProjectFilesPaneProps {
  files: ProjectFileRecord[];
  onOpenFile: (fileId: number) => void;
  onOpenCommitModal: (file: ProjectFileRecord) => void | Promise<void>;
  onOpenMatchModal: (file: ProjectFileRecord) => void | Promise<void>;
  onInspectFile: (file: ProjectFileRecord) => void | Promise<void>;
  onDeleteFile: (fileId: number, fileName: string) => Promise<void>;
  onExportFile: (fileId: number, fileName: string) => Promise<void>;
  onRunFileQA: (fileId: number, fileName: string) => Promise<void>;
  ai: ProjectAIController;
  projectType?: ProjectType;
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
  onInspectFile: (file: ProjectFileRecord) => void | Promise<void>;
  onDeleteFile: (fileId: number, fileName: string) => Promise<void>;
  onExportFile: (fileId: number, fileName: string) => Promise<void>;
  onRunFileQA: (fileId: number, fileName: string) => Promise<void>;
  onRequestAITranslate: (file: ProjectFileRecord) => void;
  supportsTMWorkflow: boolean;
  isReviewProject: boolean;
  isCustomProject: boolean;
}

function ProjectFileCard({
  file,
  ai,
  onOpenFile,
  onOpenCommitModal,
  onOpenMatchModal,
  onInspectFile,
  onDeleteFile,
  onExportFile,
  onRunFileQA,
  onRequestAITranslate,
  supportsTMWorkflow,
  isReviewProject,
  isCustomProject,
}: ProjectFileCardProps) {
  const progressBuckets = deriveFileProgressBuckets(file);
  const progress = toPercent(progressBuckets);
  const job = useTrackedFileJob(ai, file.id);
  const jobRunning = job?.status === 'running';

  return (
    <Card
      variant="surface"
      className="flex items-center justify-between p-4 hover:border-brand/40 hover:shadow-sm transition-all group"
    >
      <div className="flex-1 cursor-pointer" onClick={() => onOpenFile(file.id)}>
        <h4 className="font-bold text-text group-hover:text-brand">{file.name}</h4>
        <div className="flex items-center gap-4 mt-1">
          <div className="w-32 h-1.5 bg-muted rounded-full overflow-hidden flex">
            <div className="h-full bg-danger" style={{ width: `${progress.qaProblemPct}%` }} />
            <div className="h-full bg-success" style={{ width: `${progress.confirmedPct}%` }} />
            <div className="h-full bg-warning" style={{ width: `${progress.inProgressPct}%` }} />
          </div>
          <span className="text-[10px] text-text-faint font-medium">
            {progress.confirmedDisplayPct}% ({progressBuckets.confirmedSegmentsForBar}/
            {progressBuckets.totalSegments})
          </span>
        </div>
        {job && (
          <div className="mt-2 w-48">
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full ${job.status === 'failed' ? 'bg-danger' : 'bg-brand'}`}
                style={{ width: `${job.progress || 0}%` }}
              />
            </div>
            <div className="text-[10px] text-text-faint mt-1">
              {job.message || (job.status === 'completed' ? 'Completed' : 'In progress')}
            </div>
          </div>
        )}
      </div>
      <div className="flex max-w-[34rem] flex-wrap items-center justify-end gap-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        {supportsTMWorkflow && (
          <Button
            onClick={() => void onOpenCommitModal(file)}
            variant="soft"
            size="sm"
            className="!bg-info-soft !text-info"
          >
            Commit
          </Button>
        )}
        {supportsTMWorkflow && (
          <Button
            onClick={() => void onOpenMatchModal(file)}
            variant="soft"
            size="sm"
            className="!bg-info-soft !text-info"
          >
            TM Match
          </Button>
        )}
        {supportsTMWorkflow && (
          <Button
            onClick={() => void onInspectFile(file)}
            variant="soft"
            size="sm"
            className="!bg-info-soft !text-info"
          >
            Inspect
          </Button>
        )}
        {supportsTMWorkflow ? (
          <>
            <Button
              onClick={() => onRequestAITranslate(file)}
              disabled={jobRunning}
              variant="soft"
              size="sm"
              className="!bg-success-soft !text-success"
            >
              {jobRunning ? 'AI Translating...' : 'AI Translate'}
            </Button>
          </>
        ) : (
          <Button
            onClick={() => void ai.startAITranslateFile(file.id, file.name)}
            disabled={jobRunning}
            variant="soft"
            size="sm"
            className="!bg-success-soft !text-success"
          >
            {jobRunning
              ? isReviewProject
                ? 'AI Reviewing...'
                : isCustomProject
                  ? 'AI Processing...'
                  : 'AI Translating...'
              : isReviewProject
                ? 'AI Review'
                : isCustomProject
                  ? 'AI Process'
                  : 'AI Translate'}
          </Button>
        )}
        {supportsTMWorkflow && (
          <Button
            onClick={() => void onRunFileQA(file.id, file.name)}
            variant="soft"
            size="sm"
            className="!bg-warning-soft !text-warning"
          >
            Run QA
          </Button>
        )}
        <Button onClick={() => onOpenFile(file.id)} variant="soft" size="sm">
          Open
        </Button>
        <Button onClick={() => void onExportFile(file.id, file.name)} variant="secondary" size="sm">
          Export
        </Button>
        <IconButton
          onClick={() => void onDeleteFile(file.id, file.name)}
          tone="danger"
          size="sm"
          title="Delete File"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </IconButton>
      </div>
    </Card>
  );
}

export function ProjectFilesPane({
  files,
  onOpenFile,
  onOpenCommitModal,
  onOpenMatchModal,
  onInspectFile,
  onDeleteFile,
  onExportFile,
  onRunFileQA,
  ai,
  projectType = 'translation',
}: ProjectFilesPaneProps) {
  const [aiTranslateFile, setAiTranslateFile] = useState<{ id: number; name: string } | null>(null);
  const isReviewProject = projectType === 'review';
  const isCustomProject = projectType === 'custom';
  const supportsTMWorkflow = projectType === 'translation';
  const handleRequestAITranslate = useCallback((file: ProjectFileRecord) => {
    setAiTranslateFile({ id: file.id, name: file.name });
  }, []);

  return (
    <div className="max-w-4xl mx-auto">
      <ProjectAIPane ai={ai} projectType={projectType} />
      {aiTranslateFile && (
        <ProjectAITranslateModal
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

      <h3 className="text-sm font-bold text-text-faint uppercase tracking-wider mb-6">Files</h3>

      {files.length === 0 ? (
        <Card variant="subtle" className="text-center py-20 border-2 border-dashed">
          <p className="text-text-muted">
            No files added yet. Click &quot;+ Add File&quot; to start.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {files.map((file) => (
            <ProjectFileCard
              key={file.id}
              file={file}
              ai={ai}
              onOpenFile={onOpenFile}
              onOpenCommitModal={onOpenCommitModal}
              onOpenMatchModal={onOpenMatchModal}
              onInspectFile={onInspectFile}
              onDeleteFile={onDeleteFile}
              onExportFile={onExportFile}
              onRunFileQA={onRunFileQA}
              onRequestAITranslate={handleRequestAITranslate}
              supportsTMWorkflow={supportsTMWorkflow}
              isReviewProject={isReviewProject}
              isCustomProject={isCustomProject}
            />
          ))}
        </div>
      )}
    </div>
  );
}
