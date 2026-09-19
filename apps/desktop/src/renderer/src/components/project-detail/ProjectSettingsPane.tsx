import type { ProjectType } from '@cat/core/project';
import type { ProjectAIController } from '../../hooks/projectDetail/useProjectAI';
import type { ProjectQAController } from '../../hooks/projectDetail/useProjectQASettings';
import { Button, Icon, Tabs, TabsList, TabsPanel } from '../ui';
import { ProjectAIPane } from './ProjectAIPane';
import { ProjectQAPane } from './ProjectQAPane';

export type ProjectSettingsSection = 'ai' | 'qa';

interface Props {
  ai: ProjectAIController;
  qa: ProjectQAController;
  projectType: ProjectType;
  section: ProjectSettingsSection;
  onSectionChange: (section: ProjectSettingsSection) => void;
}

export function ProjectSettingsPane({ ai, qa, projectType, section, onSectionChange }: Props) {
  const supportsQA = projectType === 'translation';
  const activeSection = supportsQA ? section : 'ai';
  const isAI = activeSection === 'ai';
  const dirty = isAI ? ai.hasUnsavedPromptChanges : qa.hasChanges;
  const saving = isAI ? ai.savingPrompt : qa.saving;
  const save = isAI ? ai.savePrompt : qa.save;
  const discard = isAI ? ai.discardChanges : qa.discard;

  return (
    <Tabs
      value={activeSection}
      onValueChange={(value) => onSectionChange(value as ProjectSettingsSection)}
      className="w-full max-w-3xl"
    >
      <div className="mb-6">
        <TabsList
          label="Project settings sections"
          variant="neutral"
          items={[
            { value: 'ai', label: 'AI' },
            ...(supportsQA ? [{ value: 'qa', label: 'QA' }] : []),
          ]}
        />
      </div>
      <TabsPanel value={activeSection}>
        <form
          aria-label={isAI ? 'AI settings' : 'QA settings'}
          onSubmit={(event) => {
            event.preventDefault();
            if (!saving) void save();
          }}
        >
          <fieldset disabled={saving} className="min-w-0">
            {isAI ? <ProjectAIPane ai={ai} projectType={projectType} /> : <ProjectQAPane qa={qa} />}
          </fieldset>
          <div className="sticky bottom-0 mt-6 flex min-h-16 items-center justify-end gap-2 border-t border-border-subtle bg-canvas py-3">
            {dirty || saving ? (
              <>
                <Button onClick={discard} disabled={saving}>
                  Discard
                </Button>
                <Button type="submit" variant="primary" loading={saving}>
                  Save
                </Button>
              </>
            ) : (
              <span
                role="status"
                className="inline-flex items-center gap-1.5 text-xs text-text-muted"
              >
                <Icon name="check" /> Saved
              </span>
            )}
          </div>
        </form>
      </TabsPanel>
    </Tabs>
  );
}
