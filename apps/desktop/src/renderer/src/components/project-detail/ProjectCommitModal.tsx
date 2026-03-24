import type { MountedTM, ProjectFileRecord } from '../../../../shared/ipc';
import { Button, Modal, Select } from '../ui';

interface ProjectCommitModalProps {
  file: ProjectFileRecord | null;
  mountedTMs: MountedTM[];
  selectedTmId: string;
  onSelectedTmIdChange: (tmId: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ProjectCommitModal({
  file,
  mountedTMs,
  selectedTmId,
  onSelectedTmIdChange,
  onCancel,
  onConfirm,
}: ProjectCommitModalProps) {
  if (!file) return null;

  const mountedMainTMs = mountedTMs.filter((tm) => tm.type === 'main');

  return (
    <Modal
      open={true}
      onClose={onCancel}
      size="md"
      title="Commit File To Main TM"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="soft" onClick={onConfirm} disabled={!selectedTmId}>
            Commit
          </Button>
        </>
      }
    >
      <p className="text-xs text-text-muted">
        Select a Main TM for file: <span className="font-semibold">{file.name}</span>
      </p>
      <Select value={selectedTmId} onChange={(event) => onSelectedTmIdChange(event.target.value)}>
        {mountedMainTMs.map((tm) => (
          <option key={tm.id} value={tm.id}>
            {tm.name} ({tm.srcLang}→{tm.tgtLang})
          </option>
        ))}
      </Select>
    </Modal>
  );
}
