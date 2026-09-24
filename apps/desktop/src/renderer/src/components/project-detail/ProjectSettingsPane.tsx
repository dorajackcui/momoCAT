import type { ProjectType } from '@cat/core/project';
import type { ProjectAIController } from '../../hooks/projectDetail/useProjectAI';
import { Button, Icon } from '../ui';
import { ProjectAIPane } from './ProjectAIPane';

interface Props {
  ai: ProjectAIController;
  projectType: ProjectType;
}

export function ProjectSettingsPane({ ai, projectType }: Props) {
  return (
    <form
      className="w-full max-w-3xl"
      aria-label="AI settings"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ai.savingPrompt) void ai.savePrompt();
      }}
    >
      <fieldset disabled={ai.savingPrompt}>
        <ProjectAIPane ai={ai} projectType={projectType} />
      </fieldset>
      <div className="sticky bottom-0 mt-6 flex min-h-16 items-center justify-end gap-2 border-t border-border-subtle bg-canvas py-3">
        {ai.hasUnsavedPromptChanges || ai.savingPrompt ? (
          <>
            <Button onClick={ai.discardChanges} disabled={ai.savingPrompt}>
              Discard
            </Button>
            <Button type="submit" variant="primary" loading={ai.savingPrompt}>
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
