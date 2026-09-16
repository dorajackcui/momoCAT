import { useState } from 'react';
import type { AIBatchTargetBaseline } from '../../../../shared/ipc';
import { Button, Modal, Select } from '../ui';

export interface ProjectAITranslateSubmit {
  targetBaseline: AIBatchTargetBaseline;
  scope?: 'file' | 'filtered';
}

interface ProjectAITranslateModalProps {
  open: boolean;
  fileName: string | null;
  filteredSegmentCount?: number;
  totalSegmentCount?: number;
  onClose: () => void;
  onConfirm: (options: ProjectAITranslateSubmit) => void;
}

function formatSegmentCount(count: number): string {
  return `${count} ${count === 1 ? 'segment' : 'segments'}`;
}

export function ProjectAITranslateModal({
  open,
  fileName,
  filteredSegmentCount,
  totalSegmentCount,
  onClose,
  onConfirm,
}: ProjectAITranslateModalProps) {
  const [targetBaseline, setTargetBaseline] =
    useState<AIBatchTargetBaseline>('use-current-targets');
  const [scope, setScope] = useState<'file' | 'filtered'>(
    filteredSegmentCount === undefined ? 'file' : 'filtered',
  );
  const hasFilteredScope = filteredSegmentCount !== undefined;
  const selectedCount = scope === 'filtered' ? filteredSegmentCount : totalSegmentCount;

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
            tone="success"
            variant="soft"
            disabled={selectedCount === 0}
            onClick={() => onConfirm({ targetBaseline, ...(hasFilteredScope ? { scope } : {}) })}
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
        {hasFilteredScope ? (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-text-muted">Translation Scope</span>
            <Select
              aria-label="Translation Scope"
              value={scope}
              onChange={(event) => setScope(event.target.value as 'file' | 'filtered')}
            >
              <option value="filtered">
                Current filtered results ({formatSegmentCount(filteredSegmentCount)})
              </option>
              <option value="file">
                Entire file
                {totalSegmentCount === undefined
                  ? ''
                  : ` (${formatSegmentCount(totalSegmentCount)})`}
              </option>
            </Select>
          </label>
        ) : totalSegmentCount !== undefined ? (
          <p className="text-xs text-text-muted">
            Entire file ({formatSegmentCount(totalSegmentCount)})
          </p>
        ) : null}
        {scope === 'filtered' && (
          <p className="text-xs text-text-muted">
            Only these segments are included, in original file order. They become neighbors for AI
            context. This selection is fixed for this run.
          </p>
        )}
        {selectedCount === 0 && (
          <p className="text-xs text-text-muted">No segments to translate in this scope.</p>
        )}
        <label className="block space-y-1">
          <span className="text-xs font-medium text-text-muted">Target Baseline</span>
          <Select
            aria-label="Target Baseline"
            value={targetBaseline}
            onChange={(event) => setTargetBaseline(event.target.value as AIBatchTargetBaseline)}
          >
            <option value="use-current-targets">Use Current Targets</option>
            <option value="ignore-current-targets">Ignore Current Targets</option>
          </Select>
        </label>
      </div>

      <p className="text-[11px] text-text-faint mt-4">Confirmed segments stay locked.</p>
    </Modal>
  );
}
