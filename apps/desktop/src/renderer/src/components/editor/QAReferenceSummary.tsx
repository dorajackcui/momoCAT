import type { FileQaIssueRecord } from '@cat/core/project';
import { Button } from '../ui';
import type { QAPanelProps } from './QAPanel';

interface Props extends Pick<QAPanelProps, 'onFilter' | 'onLocate'> {
  references: NonNullable<FileQaIssueRecord['references']>;
  ids: string[];
  label: string;
}

/** Reference rows support the expected translation; they are not additional findings. */
export function QAReferenceSummary({ references, ids, label, onFilter, onLocate }: Props) {
  const reference = references[0];
  if (!reference) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 pl-2 text-xs text-text-muted">
      <Button
        variant="link"
        title="Source of the expected translation, not an additional QA finding"
        onClick={() => {
          onFilter([...new Set([...ids, reference.segmentId])], label);
          onLocate(reference.segmentId);
        }}
      >
        Reference row {reference.row}
      </Button>
      {references.length > 1 && (
        <Button
          variant="link"
          tone="inherit"
          title="Show every row with this reference translation in the editor"
          onClick={() => {
            onFilter(
              references.map((item) => item.segmentId),
              `${label} › Reference rows`,
            );
            onLocate(reference.segmentId);
          }}
        >
          View all {references.length} references
        </Button>
      )}
    </div>
  );
}
