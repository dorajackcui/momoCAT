import { useState } from 'react';
import type { AIBatchTargetBaseline } from '../../../../shared/ipc';
import { Button, Modal, Select } from '../ui';

export interface ProjectAITranslateSubmit {
  targetBaseline: AIBatchTargetBaseline;
}

interface ProjectAITranslateModalProps {
  open: boolean;
  fileName: string | null;
  onClose: () => void;
  onConfirm: (options: ProjectAITranslateSubmit) => void;
}

export function ProjectAITranslateModal({
  open,
  fileName,
  onClose,
  onConfirm,
}: ProjectAITranslateModalProps) {
  const [targetBaseline, setTargetBaseline] =
    useState<AIBatchTargetBaseline>('use-current-targets');

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="AI Translate Options"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="soft"
            className="!bg-success-soft !text-success"
            onClick={() => onConfirm({ targetBaseline })}
          >
            Start AI Translate
          </Button>
        </>
      }
    >
      <p className="text-xs text-text-muted">
        Configure AI translation for file: <span className="font-semibold">{fileName || '-'}</span>
      </p>

      <div className="space-y-3 mt-4">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-text-muted">Target Baseline</span>
          <Select
            aria-label="Target Baseline"
            value={targetBaseline}
            onChange={(event) =>
              setTargetBaseline(event.target.value as AIBatchTargetBaseline)
            }
          >
            <option value="use-current-targets">Use Current Targets</option>
            <option value="ignore-current-targets">Ignore Current Targets</option>
          </Select>
        </label>
      </div>

      <p className="text-[11px] text-text-faint mt-4">
        Confirmed segments stay locked.
      </p>
    </Modal>
  );
}
