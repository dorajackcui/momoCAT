import type { ProjectType } from '@cat/core/project';
import type { ProjectAIController } from '../../hooks/projectDetail/useProjectAI';
import { ProjectSettingsFooter } from './ProjectPanelParts';
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
      <ProjectSettingsFooter
        dirty={ai.hasUnsavedPromptChanges}
        saving={ai.savingPrompt}
        onDiscard={ai.discardChanges}
      />
    </form>
  );
}
