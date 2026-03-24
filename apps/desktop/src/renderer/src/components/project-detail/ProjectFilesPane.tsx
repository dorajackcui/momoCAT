import { useState } from 'react';
import { ProjectType } from '@cat/core';
import type { ProjectFileRecord } from '../../../../shared/ipc';
import { ProjectAIController } from '../../hooks/projectDetail/useProjectAI';
import { Button, Card, IconButton } from '../ui';
import { ProjectAIPane } from './ProjectAIPane';
import { ProjectAITranslateModal } from './ProjectAITranslateModal';
import { deriveFileProgressBuckets, toPercent } from './fileProgressStats';

interface ProjectFilesPaneProps {
  files: ProjectFileRecord[];
  onOpenFile: (fileId: number) => void;
  onOpenCommitModal: (file: ProjectFileRecord) => void;
  onOpenMatchModal: (file: ProjectFileRecord) => void;
  onDeleteFile: (fileId: number, fileName: string) => Promise<void>;
  onExportFile: (fileId: number, fileName: string) => Promise<void>;
  onRunFileQA: (fileId: number, fileName: string) => Promise<void>;
  ai: ProjectAIController;
  projectType?: ProjectType;
}

export function ProjectFilesPane({
  files,
  onOpenFile,
  onOpenCommitModal,
  onOpenMatchModal,
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
  return (
    <div className="max-w-4xl mx-auto">
      <ProjectAIPane ai={ai} projectType={projectType} />
      {aiTranslateFile && (
        <ProjectAITranslateModal
          open={true}
          fileName={aiTranslateFile.name}
          onClose={() => setAiTranslateFile(null)}
          onConfirm={(options) => {
            void ai.startAITranslateFile(aiTranslateFile.id, aiTranslateFile.name, {
              mode: options.mode,
              targetScope: options.targetScope,
              confirm: false,
            });
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
          {files.map((file) => {
            const progressBuckets = deriveFileProgressBuckets(file);
            const progress = toPercent(progressBuckets);
            const job = ai.getFileJob(file.id);
            const jobRunning = job?.status === 'running';

            return (
              <Card
                key={file.id}
                variant="surface"
                className="flex items-center justify-between p-4 hover:border-brand/40 hover:shadow-sm transition-all group"
              >
                <div className="flex-1 cursor-pointer" onClick={() => onOpenFile(file.id)}>
                  <h4 className="font-bold text-text group-hover:text-brand">{file.name}</h4>
                  <div className="flex items-center gap-4 mt-1">
                    <div className="w-32 h-1.5 bg-muted rounded-full overflow-hidden flex">
                      <div
                        className="h-full bg-danger"
                        style={{ width: `${progress.qaProblemPct}%` }}
                      />
                      <div
                        className="h-full bg-success"
                        style={{ width: `${progress.confirmedPct}%` }}
                      />
                      <div
                        className="h-full bg-warning"
                        style={{ width: `${progress.inProgressPct}%` }}
                      />
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
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {supportsTMWorkflow && (
                    <Button
                      onClick={() => onOpenCommitModal(file)}
                      variant="soft"
                      size="sm"
                      className="!bg-info-soft !text-info"
                    >
                      Commit
                    </Button>
                  )}
                  {supportsTMWorkflow && (
                    <Button
                      onClick={() => onOpenMatchModal(file)}
                      variant="soft"
                      size="sm"
                      className="!bg-info-soft !text-info"
                    >
                      TM Match
                    </Button>
                  )}
                  {supportsTMWorkflow ? (
                    <>
                      <Button
                        onClick={() => setAiTranslateFile({ id: file.id, name: file.name })}
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
                  <Button
                    onClick={() => void onExportFile(file.id, file.name)}
                    variant="secondary"
                    size="sm"
                  >
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
          })}
        </div>
      )}
    </div>
  );
}
