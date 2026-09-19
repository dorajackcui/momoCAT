import type { MountedTB, TBWithStats } from '../../../../shared/ipc';
import { Card, Icon, IconButton, Select } from '../ui';

interface ProjectTBPaneProps {
  mountedTBs: MountedTB[];
  allTBs: TBWithStats[];
  onMountTB: (tbId: string) => void;
  onUnmountTB: (tbId: string) => void;
}

export function ProjectTBPane({ mountedTBs, allTBs, onMountTB, onUnmountTB }: ProjectTBPaneProps) {
  return (
    <div className="w-full max-w-4xl space-y-8">
      <div>
        <div className="flex justify-between items-end mb-4">
          <h3 className="text-sm font-bold text-text-faint uppercase tracking-wider">
            Mounted Term Bases
          </h3>
          <div className="flex items-center gap-2">
            <Select
              size="sm"
              onChange={(event) => {
                if (!event.target.value) return;
                onMountTB(event.target.value);
              }}
              value=""
            >
              <option value="" disabled>
                + Term Base
              </option>
              {allTBs
                .filter((tb) => !mountedTBs.find((mounted) => mounted.id === tb.id))
                .map((tb) => (
                  <option key={tb.id} value={tb.id}>
                    {tb.name} ({tb.srcLang}→{tb.tgtLang})
                  </option>
                ))}
            </Select>
          </div>
        </div>

        {mountedTBs.length === 0 ? (
          <Card variant="subtle" className="p-8 text-center border-dashed">
            <p className="text-xs text-text-faint">No term base mounted to this project yet.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {mountedTBs.map((tb) => (
              <Card key={tb.id} variant="surface" className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <Icon name="book-open" className="h-5 w-5 shrink-0 text-text-muted" />
                  <div>
                    <h4 className="font-bold text-text">{tb.name}</h4>
                    <p className="text-caption text-text-faint font-medium uppercase tracking-wider">
                      {tb.srcLang} → {tb.tgtLang}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <span className="block text-sm font-bold text-text-muted">
                      {tb.stats?.entryCount || 0}
                    </span>
                    <span className="text-reference-meta font-bold text-text-faint uppercase">
                      Terms
                    </span>
                  </div>
                  <IconButton
                    onClick={() => onUnmountTB(tb.id)}
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
