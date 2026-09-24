import type { ProjectQAController } from '../../hooks/projectDetail/useProjectQASettings';
import { Button, Icon } from '../ui';
import { ProjectQAPane } from './ProjectQAPane';

export function ProjectQASettingsPane({ qa }: { qa: ProjectQAController }) {
  return (
    <form
      className="w-full max-w-3xl"
      aria-label="QA settings"
      onSubmit={(event) => {
        event.preventDefault();
        if (!qa.saving) void qa.save();
      }}
    >
      <fieldset disabled={qa.saving}>
        <ProjectQAPane qa={qa} />
      </fieldset>
      <div className="sticky bottom-0 mt-6 flex min-h-16 items-center justify-end gap-2 border-t border-border-subtle bg-canvas py-3">
        {qa.hasChanges || qa.saving ? (
          <>
            <Button onClick={qa.discard} disabled={qa.saving}>
              Discard
            </Button>
            <Button type="submit" variant="primary" loading={qa.saving}>
              Save
            </Button>
          </>
        ) : (
          <span role="status" className="inline-flex items-center gap-1.5 text-xs text-text-muted">
            <Icon name="check" /> Saved
          </span>
        )}
      </div>
    </form>
  );
}
