import type { MountedTM, ProjectFileRecord } from '../../../../shared/ipc';
import { Button, Modal, Select } from '../ui';

interface ProjectMatchModalProps {
  file: ProjectFileRecord | null;
  mountedTMs: MountedTM[];
  selectedTmId: string;
  onSelectedTmIdChange: (tmId: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ProjectMatchModal({
  file,
  mountedTMs,
  selectedTmId,
  onSelectedTmIdChange,
  onCancel,
  onConfirm,
}: ProjectMatchModalProps) {
  if (!file) return null;

  return (
    <Modal
      open={true}
      onClose={onCancel}
      size="md"
      title="Batch Match Segments (100%)"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={!selectedTmId}>
            Run Match
          </Button>
        </>
      }
    >
      <p className="text-xs text-text-muted">
        Select TM for file: <span className="font-semibold">{file.name}</span>
      </p>
      <Select value={selectedTmId} onChange={(event) => onSelectedTmIdChange(event.target.value)}>
        {mountedTMs.map((tm) => (
          <option key={tm.id} value={tm.id}>
            {tm.name} ({tm.type})
          </option>
        ))}
      </Select>
      <p className="text-[11px] text-text-faint">
        Current behavior only applies exact 100% matches, skips already confirmed segments, and sets
        applied matches to confirmed.
      </p>
    </Modal>
  );
}
