import type { ProjectQAController } from '../../hooks/projectDetail/useProjectQASettings';
import { ProjectSettingsFooter } from './ProjectPanelParts';
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
      <ProjectSettingsFooter dirty={qa.hasChanges} saving={qa.saving} onDiscard={qa.discard} />
    </form>
  );
}
