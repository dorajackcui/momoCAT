import type { ReactNode } from 'react';
import { Button, Icon, IconButton } from '../ui';

export function ProjectSectionHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="workspace-section-heading mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      {children}
    </div>
  );
}

export function ProjectSettingsFooter({
  dirty,
  saving,
  onDiscard,
}: {
  dirty: boolean;
  saving: boolean;
  onDiscard: () => void;
}) {
  if (!dirty && !saving) return null;

  return (
    <div className="sticky bottom-0 mt-6 flex min-h-16 items-center justify-end gap-2 rounded-panel border border-border bg-surface px-4 py-3">
      <Button onClick={onDiscard} disabled={saving}>
        Discard
      </Button>
      <Button type="submit" variant="primary" loading={saving}>
        Save
      </Button>
    </div>
  );
}

export function ProjectResourceCard({
  name,
  icon,
  languages,
  count,
  unit,
  children,
}: {
  name: string;
  icon: 'database' | 'book-open';
  languages: string;
  count: number;
  unit: 'segments' | 'terms';
  children: ReactNode;
}) {
  return (
    <li>
      <div className="workspace-config-section flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <Icon name={icon} className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
          <div className="min-w-0">
            <h4 className="break-words text-sm font-medium text-text">{name}</h4>
            <p className="mt-1 text-xs text-text-muted">{languages}</p>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-4">
          <span className="whitespace-nowrap text-xs tabular-nums text-text-muted">
            {count} {count === 1 ? unit.slice(0, -1) : unit}
          </span>
          <div className="flex items-center gap-2">{children}</div>
        </div>
      </div>
    </li>
  );
}

export function ProjectResourceUnmount({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <IconButton
      size="sm"
      variant="ghost"
      tone="danger"
      title="Unmount from project"
      aria-label={`Unmount ${name} from project`}
      onClick={onClick}
    >
      <svg
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M6 18L18 6M6 6l12 12"
        />
      </svg>
    </IconButton>
  );
}
