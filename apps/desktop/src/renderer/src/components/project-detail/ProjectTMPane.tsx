import type { MountedTM, TMRecord } from '../../../../shared/ipc';
import type { ProjectTMLoadState } from '../../hooks/projectDetail/useProjectDetailData';
import { Button, Card, Icon, IconButton, Select } from '../ui';

interface ProjectTMPaneProps {
  mountedTMs: MountedTM[];
  allMainTMs: TMRecord[];
  loadState: ProjectTMLoadState;
  onRetry: () => void;
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
  onUnmountTM,
  onExportWorkingTM,
  onResetWorkingTM,
  disabled = false,
}: ProjectTMPaneProps) {
  const workingTMs = mountedTMs.filter((tm) => tm.type === 'working');
  const mountedMainTMs = mountedTMs.filter((tm) => tm.type === 'main');
  const initialError = loadState.status === 'error' && !loadState.hasLoaded;

  if (loadState.status === 'loading' || initialError) {
    return (
      <div className="w-full max-w-4xl">
        <Card variant="surface" className="p-8 text-center">
          <p
            className={initialError ? 'text-sm text-danger' : 'text-sm text-text-muted'}
            role={initialError ? 'alert' : 'status'}
          >
            {initialError
              ? `Could not load translation memories: ${loadState.message}`
              : 'Loading translation memories…'}
          </p>
          {initialError ? (
            <Button type="button" size="sm" variant="secondary" className="mt-4" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl space-y-8">
      {loadState.status === 'error' ? (
        <Card variant="surface" className="p-4 flex items-center justify-between gap-4">
          <p className="text-sm text-danger" role="alert">
            Could not refresh translation memories: {loadState.message}
          </p>
          <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </Card>
      ) : null}

      <div>
        <h3 className="text-sm font-bold text-text-faint uppercase tracking-wider mb-4">
          Working Translation Memory
        </h3>
        <Card variant="surface" className="p-6 border-brand/20">
          {workingTMs.length === 0 ? (
            <p className="text-xs text-text-faint text-center">
              No Working TM is mounted to this project.
            </p>
          ) : (
            workingTMs.map((tm) => (
              <div key={tm.id} className="flex flex-wrap justify-between items-center gap-5">
                <div>
                  <h4 className="flex items-center gap-2 font-bold text-brand">
                    <Icon name="database" />
                    {tm.name}
                  </h4>
                  <p className="text-xs text-brand mt-1">
                    Automatic updates on segment confirmation. Read/Write enabled.
                  </p>
                </div>
                <div className="flex items-center gap-5">
                  <div className="text-right min-w-14">
                    <span className="block text-lg font-bold text-brand">{tm.entryCount || 0}</span>
                    <span className="text-caption font-bold text-brand/80 uppercase tracking-tight">
                      Segments
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={disabled || !tm.entryCount}
                      onClick={() => onExportWorkingTM(tm)}
                    >
                      Export
                    </Button>
                    <Button
                      tone="danger"
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={disabled || !tm.entryCount}
                      onClick={() => onResetWorkingTM(tm)}
                    >
                      Reset
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </Card>
      </div>

      <div>
        <div className="flex justify-between items-end mb-4">
          <h3 className="text-sm font-bold text-text-faint uppercase tracking-wider">
            Mounted Main TMs (Read-only)
          </h3>
          <div className="flex items-center gap-2">
            <Select
              size="sm"
              onChange={(event) => {
                if (!event.target.value) return;
                onMountTM(event.target.value);
              }}
              value=""
            >
              <option value="" disabled>
                + Main TM
              </option>
              {allMainTMs
                .filter((tm) => !mountedTMs.find((mounted) => mounted.id === tm.id))
                .map((tm) => (
                  <option key={tm.id} value={tm.id}>
                    {tm.name} ({tm.srcLang}→{tm.tgtLang})
                  </option>
                ))}
            </Select>
          </div>
        </div>

        {mountedMainTMs.length === 0 ? (
          <Card variant="subtle" className="p-8 text-center border-dashed">
            <p className="text-xs text-text-faint">No Main TMs mounted to this project yet.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {mountedMainTMs.map((tm) => (
              <Card key={tm.id} variant="surface" className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <Icon name="database" className="h-5 w-5 shrink-0 text-text-muted" />
                  <div>
                    <h4 className="font-bold text-text">{tm.name}</h4>
                    <p className="text-caption text-text-faint font-medium uppercase tracking-wider">
                      {tm.srcLang} → {tm.tgtLang}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <span className="block text-sm font-bold text-text-muted">
                      {tm.entryCount || 0}
                    </span>
                    <span className="text-reference-meta font-bold text-text-faint uppercase">
                      Segments
                    </span>
                  </div>
                  <IconButton
                    onClick={() => onUnmountTM(tm.id)}
                    tone="danger"
                    size="sm"
                    title="Unmount from Project"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </IconButton>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
