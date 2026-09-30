import type { CloudResourceSummary } from '../../../../shared/cloud';
import type { MountedTM, TMRecord } from '../../../../shared/ipc';
import type { ProjectTMLoadState } from '../../hooks/projectDetail/useProjectDetailData';
import { Button, Notice, Select } from '../ui';
import {
  ProjectResourceCard,
  ProjectResourceUnmount,
  ProjectSectionHeader,
} from './ProjectPanelParts';

interface ProjectTMPaneProps {
  mountedTMs: MountedTM[];
  allMainTMs: TMRecord[];
  loadState: ProjectTMLoadState;
  onRetry: () => void;
  localResources?: CloudResourceSummary[];
  onCopyAndMount?: (id: string) => void;
  onMountTM: (tmId: string) => void;
  onUnmountTM: (tmId: string) => void;
  onExportWorkingTM: (tm: MountedTM) => void;
  onResetWorkingTM: (tm: MountedTM) => void;
  disabled?: boolean;
}

export function ProjectTMPane({
  mountedTMs,
  allMainTMs,
  loadState,
  onRetry,
  onMountTM,
  localResources,
  onCopyAndMount,
  onUnmountTM,
  onExportWorkingTM,
  onResetWorkingTM,
  disabled = false,
}: ProjectTMPaneProps) {
  const workingTMs = mountedTMs.filter((tm) => tm.type === 'working');
  const mountedMainTMs = mountedTMs.filter((tm) => tm.type === 'main');
  const initialError = loadState.status === 'error' && !loadState.hasLoaded;
  const error =
    loadState.status === 'error' ? (
      <Notice tone="danger" className="flex items-center justify-between gap-4 text-xs">
        <p role="alert">
          Could not {initialError ? 'load' : 'refresh'} translation memories: {loadState.message}
        </p>
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      </Notice>
    ) : null;

  if (loadState.status === 'loading' || initialError) {
    return (
      <div className="w-full max-w-3xl">
        {error ?? (
          <p role="status" className="py-4 text-sm text-text-muted">
            Loading translation memories…
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl space-y-6">
      {error}
      <section aria-label="Working TM">
        <ProjectSectionHeader title="Working TM" />
        <p className="mb-3 text-xs text-text-muted">Updated when segments are confirmed.</p>
        {workingTMs.length === 0 ? (
          <p className="border-y border-border-subtle py-4 text-xs text-text-muted">
            No Working TM is mounted to this project.
          </p>
        ) : (
          <ul className="space-y-2">
            {workingTMs.map((tm) => (
              <ProjectResourceCard
                key={tm.id}
                icon="database"
                name={tm.name}
                languages={tm.srcLang + ' → ' + tm.tgtLang}
                count={tm.entryCount || 0}
                unit="segments"
              >
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={disabled || !tm.entryCount}
                  onClick={() => onExportWorkingTM(tm)}
                >
                  Export
                </Button>
                <Button
                  tone="danger"
                  size="sm"
                  variant="ghost"
                  disabled={disabled || !tm.entryCount}
                  onClick={() => onResetWorkingTM(tm)}
                >
                  Reset
                </Button>
              </ProjectResourceCard>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Mounted TMs">
        <ProjectSectionHeader title="Mounted TMs">
          <Select
            size="sm"
            aria-label="Mount translation memory"
            className="w-auto max-w-full sm:max-w-xs"
            onChange={(event) => {
              const value = event.target.value;
              if (value.startsWith('local:')) onCopyAndMount?.(value.slice(6));
              else if (value) onMountTM(value);
            }}
            value=""
          >
            <option value="" disabled>
              + Main TM
            </option>
            {allMainTMs
              .filter((tm) => !mountedTMs.some((mounted) => mounted.id === tm.id))
              .map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name} ({tm.srcLang} → {tm.tgtLang})
                </option>
              ))}
            {!!localResources?.length && (
              <optgroup label="Create cloud copy from local">
                {localResources.map((resource) => (
                  <option key={`local:${resource.id}`} value={`local:${resource.id}`}>
                    {resource.name} ({resource.srcLang} → {resource.tgtLang}) · create cloud copy
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </ProjectSectionHeader>
        <p className="mb-3 text-xs text-text-muted">Read-only references.</p>
        {mountedMainTMs.length === 0 ? (
          <p className="border-y border-border-subtle py-4 text-xs text-text-muted">
            No Main TMs mounted to this project yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {mountedMainTMs.map((tm) => (
              <ProjectResourceCard
                key={tm.id}
                icon="database"
                name={tm.name}
                languages={tm.srcLang + ' → ' + tm.tgtLang}
                count={tm.entryCount || 0}
                unit="segments"
              >
                <ProjectResourceUnmount name={tm.name} onClick={() => onUnmountTM(tm.id)} />
              </ProjectResourceCard>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
