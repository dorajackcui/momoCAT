import type { MountedTB, TBWithStats } from '../../../../shared/ipc';
import { Select } from '../ui';
import {
  ProjectResourceCard,
  ProjectResourceUnmount,
  ProjectSectionHeader,
} from './ProjectPanelParts';

interface ProjectTBPaneProps {
  mountedTBs: MountedTB[];
  allTBs: TBWithStats[];
  onMountTB: (tbId: string) => void;
  onUnmountTB: (tbId: string) => void;
}

export function ProjectTBPane({ mountedTBs, allTBs, onMountTB, onUnmountTB }: ProjectTBPaneProps) {
  return (
    <div className="w-full max-w-3xl">
      <section aria-label="Mounted term bases">
        <ProjectSectionHeader title="Mounted term bases">
          <Select
            size="sm"
            aria-label="Mount term base"
            className="w-auto max-w-full sm:max-w-xs"
            onChange={(event) => {
              if (event.target.value) onMountTB(event.target.value);
            }}
            value=""
          >
            <option value="" disabled>
              + Term base
            </option>
            {allTBs
              .filter((tb) => !mountedTBs.some((mounted) => mounted.id === tb.id))
              .map((tb) => (
                <option key={tb.id} value={tb.id}>
                  {tb.name} ({tb.srcLang} → {tb.tgtLang})
                </option>
              ))}
          </Select>
        </ProjectSectionHeader>
        {mountedTBs.length === 0 ? (
          <p className="border-y border-border-subtle py-4 text-xs text-text-muted">
            No term base mounted to this project yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {mountedTBs.map((tb) => (
              <ProjectResourceCard
                key={tb.id}
                icon="book-open"
                name={tb.name}
                languages={tb.srcLang + ' → ' + tb.tgtLang}
                count={tb.stats?.entryCount || 0}
                unit="terms"
              >
                <ProjectResourceUnmount name={tb.name} onClick={() => onUnmountTB(tb.id)} />
              </ProjectResourceCard>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
