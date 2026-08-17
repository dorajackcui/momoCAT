import type { MountedTM, ProjectFileRecord, TMCommitScope } from '../../../../shared/ipc';
import { Button, Modal, Select } from '../ui';

interface ProjectCommitModalProps {
  file: ProjectFileRecord | null;
  mountedTMs: MountedTM[];
  selectedTmId: string;
  commitScope: TMCommitScope;
  onSelectedTmIdChange: (tmId: string) => void;
  onCommitScopeChange: (scope: TMCommitScope) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function getMountedCommitTargets(mountedTMs: MountedTM[]): MountedTM[] {
  return mountedTMs.filter(
    (tm) =>
      tm.type === 'main' ||
      (tm.type === 'working' && (tm.permission === 'write' || tm.permission === 'readwrite')),
  );
}

export function getDefaultMountedCommitTarget(mountedTMs: MountedTM[]): MountedTM | undefined {
  const targets = getMountedCommitTargets(mountedTMs);
  return targets.find((tm) => tm.type === 'main') ?? targets[0];
}

export function ProjectCommitModal({
  file,
  mountedTMs,
  selectedTmId,
  commitScope,
  onSelectedTmIdChange,
  onCommitScopeChange,
  onCancel,
  onConfirm,
}: ProjectCommitModalProps) {
  if (!file) return null;

  const commitTargets = getMountedCommitTargets(mountedTMs);

  return (
    <Modal
      open={true}
      onClose={onCancel}
      size="md"
      title="Commit File To TM"
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
        Select a mounted TM for file: <span className="font-semibold">{file.name}</span>
      </p>
      <Select value={selectedTmId} onChange={(event) => onSelectedTmIdChange(event.target.value)}>
        {commitTargets.map((tm) => (
          <option key={tm.id} value={tm.id}>
            {tm.name} ({tm.type === 'working' ? 'Working TM' : 'Main TM'}, {tm.srcLang}→{tm.tgtLang}
            )
          </option>
        ))}
      </Select>
      <div className="space-y-2">
        <p className="text-xs font-semibold text-text-muted">Commit scope</p>
        <div className="flex surface-subtle p-1">
          <button
            type="button"
            onClick={() => onCommitScopeChange('confirmed-only')}
            className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded-control transition-colors ${
              commitScope === 'confirmed-only'
                ? 'bg-surface text-brand shadow-panel'
                : 'text-text-muted hover:text-text hover:bg-surface'
            }`}
          >
            Confirmed only
          </button>
          <button
            type="button"
            onClick={() => onCommitScopeChange('all')}
            className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded-control transition-colors ${
              commitScope === 'all'
                ? 'bg-surface text-brand shadow-panel'
                : 'text-text-muted hover:text-text hover:bg-surface'
            }`}
          >
            All with translations
          </button>
        </div>
      </div>
    </Modal>
  );
}
