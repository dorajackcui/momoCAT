import { useState } from 'react';
import type { ProjectType } from '@cat/core/project';
import type { AIBatchTargetBaseline } from '../../../../shared/ipc';
import { Button, Modal, Select } from '../ui';

export interface ProjectAITranslateSubmit {
  targetBaseline: AIBatchTargetBaseline;
  scope?: 'file' | 'filtered';
}

interface ProjectAITranslateModalProps {
  open: boolean;
  projectType?: ProjectType;
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
  projectType = 'translation',
  fileName,
  filteredSegmentCount,
  totalSegmentCount,
  onClose,
  onConfirm,
}: ProjectAITranslateModalProps) {
  const isCustom = projectType === 'custom';
  const action = isCustom ? 'Process' : 'Translate';
  const noun = isCustom ? 'processing' : 'translation';
  const output = isCustom ? 'Outputs' : 'Targets';
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
      title={`AI ${action} Options`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={selectedCount === 0}
            onClick={() => onConfirm({ targetBaseline, ...(hasFilteredScope ? { scope } : {}) })}
          >
            Start AI {action}
          </Button>
        </>
      }
    >
      <p className="text-xs text-text-muted">
        Configure AI {noun} for file: <span className="font-semibold">{fileName || '-'}</span>
      </p>

      <div className="space-y-3 mt-4">
        {hasFilteredScope ? (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-text-muted">
              {isCustom ? 'Processing Scope' : 'Translation Scope'}
            </span>
            <Select
              aria-label={isCustom ? 'Processing Scope' : 'Translation Scope'}
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
          <p className="text-xs text-text-muted">
            No segments to {isCustom ? 'process' : 'translate'} in this scope.
          </p>
        )}
        <label className="block space-y-1">
          <span className="text-xs font-medium text-text-muted">
            {isCustom ? 'Output Baseline' : 'Target Baseline'}
          </span>
          <Select
            aria-label={isCustom ? 'Output Baseline' : 'Target Baseline'}
            value={targetBaseline}
            onChange={(event) => setTargetBaseline(event.target.value as AIBatchTargetBaseline)}
          >
            <option value="use-current-targets">Use Current {output}</option>
            <option value="ignore-current-targets">Ignore Current {output}</option>
          </Select>
        </label>
      </div>

      <p className="text-2xs text-text-faint mt-4">Confirmed segments stay locked.</p>
    </Modal>
  );
}
