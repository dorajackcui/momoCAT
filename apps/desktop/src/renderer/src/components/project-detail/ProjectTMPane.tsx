import type { MountedTM, TMRecord } from '../../../../shared/ipc';
import { Button, Card, IconButton, Select } from '../ui';

interface ProjectTMPaneProps {
  mountedTMs: MountedTM[];
  allMainTMs: TMRecord[];
  loading: boolean;
  error: string | null;
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
  loading,
  error,
  onRetry,
  onMountTM,
  onUnmountTM,
  onExportWorkingTM,
  onResetWorkingTM,
  disabled = false,
}: ProjectTMPaneProps) {
  const workingTMs = mountedTMs.filter((tm) => tm.type === 'working');
  const mountedMainTMs = mountedTMs.filter((tm) => tm.type === 'main');

  if (loading || error) {
    return (
      <div className="max-w-4xl mx-auto">
        <Card variant="surface" className="p-8 text-center">
          <p
            className={error ? 'text-sm text-danger' : 'text-sm text-text-muted'}
            role={error ? 'alert' : 'status'}
          >
            {error
              ? `Could not load translation memories: ${error}`
              : 'Loading translation memories…'}
          </p>
          {error ? (
            <Button type="button" size="sm" variant="secondary" className="mt-4" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
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
                  <h4 className="font-bold text-brand">{tm.name}</h4>
                  <p className="text-xs text-brand mt-1">
                    Automatic updates on segment confirmation. Read/Write enabled.
                  </p>
                </div>
                <div className="flex items-center gap-5">
                  <div className="text-right min-w-14">
                    <span className="block text-lg font-bold text-brand">{tm.entryCount || 0}</span>
                    <span className="text-[10px] font-bold text-brand/80 uppercase tracking-tight">
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
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="!text-danger hover:!bg-danger-soft"
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
              className="!px-3 !py-1.5 text-xs font-medium"
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
                  <div className="w-8 h-8 bg-info-soft/80 rounded-lg flex items-center justify-center text-info">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                      />
                    </svg>
                  </div>
                  <div>
                    <h4 className="font-bold text-text">{tm.name}</h4>
                    <p className="text-[10px] text-text-faint font-medium uppercase tracking-wider">
                      {tm.srcLang} → {tm.tgtLang}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <span className="block text-sm font-bold text-text-muted">
                      {tm.entryCount || 0}
                    </span>
                    <span className="text-[9px] font-bold text-text-faint uppercase">Segments</span>
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
