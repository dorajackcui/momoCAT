import { useState } from 'react';
import type { ProjectFileRecord } from '../../../../shared/ipc';
import { Button, Modal } from '../ui';

export type ProjectReferenceAction = 'precheck' | 'export';

interface ProjectReferenceActionsModalProps {
  file: ProjectFileRecord | null;
  onClose: () => void;
  onPrecheckSourceTerms: (file: ProjectFileRecord) => void;
  onExportReferences: (file: ProjectFileRecord) => void;
}

export function runProjectReferenceAction(
  action: ProjectReferenceAction,
  file: ProjectFileRecord,
  callbacks: Pick<
    ProjectReferenceActionsModalProps,
    'onPrecheckSourceTerms' | 'onExportReferences'
  >,
): void {
  if (action === 'precheck') {
    callbacks.onPrecheckSourceTerms(file);
    return;
  }
  callbacks.onExportReferences(file);
}

export function ProjectReferenceActionsModal({
  file,
  onClose,
  onPrecheckSourceTerms,
  onExportReferences,
}: ProjectReferenceActionsModalProps) {
  const [selectedAction, setSelectedAction] = useState<ProjectReferenceAction>('precheck');
  if (!file) return null;

  const close = () => {
    setSelectedAction('precheck');
    onClose();
  };
  const confirm = () => {
    const action = selectedAction;
    setSelectedAction('precheck');
    runProjectReferenceAction(action, file, { onPrecheckSourceTerms, onExportReferences });
  };

  return (
    <Modal
      open={true}
      onClose={close}
      size="md"
      title="TM/TB Tools"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" onClick={confirm}>
            Confirm
          </Button>
        </>
      }
    >
      <p className="text-xs text-text-muted">
        Choose an operation for <span className="font-semibold">{file.name}</span>.
      </p>
      <div className="mt-4 space-y-4">
        <label
          className={`block cursor-pointer rounded-control border p-4 ${
            selectedAction === 'precheck' ? 'border-brand bg-brand-soft' : 'border-border'
          }`}
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-text">
            <input
              type="radio"
              name="reference-action"
              value="precheck"
              checked={selectedAction === 'precheck'}
              onChange={() => setSelectedAction('precheck')}
            />
            Extract Source Terms
          </span>
          <p className="mt-2 text-xs text-text-muted">
            Use AI to find source-language term candidates not covered by mounted TBs.
          </p>
        </label>
        <label
          className={`block cursor-pointer rounded-control border p-4 ${
            selectedAction === 'export' ? 'border-brand bg-brand-soft' : 'border-border'
          }`}
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-text">
            <input
              type="radio"
              name="reference-action"
              value="export"
              checked={selectedAction === 'export'}
              onChange={() => setSelectedAction('export')}
            />
            Export TM/TB References
          </span>
          <p className="mt-2 text-xs text-text-muted">
            Export the existing per-row TM and TB reference workbook.
          </p>
        </label>
      </div>
    </Modal>
  );
}
