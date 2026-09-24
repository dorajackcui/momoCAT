import { useState } from 'react';
import { QA_RULE_GROUPS, normalizeQASettings, type SegmentQaRuleId } from '@cat/core/project';
import type { ProjectQAController } from '../../hooks/projectDetail/useProjectQASettings';
import { Button, Checkbox, Icon, IconButton, Modal } from '../ui';
import { ProjectQAOptions, QA_OPTIONS_GROUPS } from './ProjectQAOptions';

const sections: Array<{ label: string; ids: SegmentQaRuleId[] }> = [
  {
    label: 'Terminology & consistency',
    ids: [
      'terminology-consistency',
      'substring-consistency',
      'source-consistency',
      'target-consistency',
    ],
  },
  { label: 'Content integrity', ids: ['tag-integrity', 'line-break', 'number', 'url'] },
  { label: 'Target text quality', ids: ['empty-target', 'chinese', 'target-text'] },
];
const groupLabel = (group: { id: SegmentQaRuleId; label: string }) =>
  group.id === 'tag-integrity'
    ? 'Standard tags'
    : group.id === 'substring-consistency'
      ? 'Substring consistency'
      : group.label;

export function ProjectQAPane({ qa }: { qa: ProjectQAController }) {
  const draft = normalizeQASettings(qa.draft);
  const [optionsGroup, setOptionsGroup] = useState<SegmentQaRuleId | null>(null);
  const activeGroup = QA_RULE_GROUPS.find((group) => group.id === optionsGroup);
  const closeOptions = () => setOptionsGroup(null);
  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            qa.onChange({ ...draft, enabledRuleIds: QA_RULE_GROUPS.map((group) => group.id) })
          }
        >
          Select all
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => qa.onChange({ ...draft, enabledRuleIds: [] })}
        >
          Clear
        </Button>
      </div>
      {sections.map((section) => (
        <section
          key={section.label}
          aria-label={section.label}
          className="space-y-2 border-b border-border-subtle pb-4"
        >
          <h3 className="text-sm font-semibold">{section.label}</h3>
          {section.label === 'Content integrity' && (
            <p className="text-xs text-text-muted">
              memoQ markers · Always checked in Protect CAT markers files
            </p>
          )}
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {section.ids.map((id) => {
              const group = QA_RULE_GROUPS.find((item) => item.id === id)!;
              const enabled = draft.enabledRuleIds.includes(id);
              return (
                <div key={id} className="flex min-h-8 items-center gap-1">
                  <label className="flex min-w-0 items-center gap-2 text-sm">
                    <Checkbox
                      checked={enabled}
                      onChange={() =>
                        qa.onChange({
                          ...draft,
                          enabledRuleIds: enabled
                            ? draft.enabledRuleIds.filter((item) => item !== id)
                            : [...draft.enabledRuleIds, id],
                        })
                      }
                    />
                    {groupLabel(group)}
                  </label>
                  {QA_OPTIONS_GROUPS.includes(id) && (
                    <IconButton
                      size="xs"
                      variant="ghost"
                      aria-label={`${groupLabel(group)} options`}
                      title={`${groupLabel(group)} options`}
                      aria-haspopup="dialog"
                      onClick={() => setOptionsGroup(id)}
                    >
                      <Icon name="settings-2" />
                    </IconButton>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={draft.instantQaOnConfirm}
          onChange={(event) => qa.onChange({ ...draft, instantQaOnConfirm: event.target.checked })}
        />
        Instant QA after Confirm
      </label>
      {activeGroup && (
        <Modal
          open
          onClose={closeOptions}
          title={`${groupLabel(activeGroup)} options`}
          size={activeGroup.id === 'tag-integrity' ? 'lg' : 'md'}
          footer={
            <Button variant="primary" onClick={closeOptions}>
              Done
            </Button>
          }
        >
          <fieldset disabled={qa.saving}>
            <ProjectQAOptions groupId={activeGroup.id} draft={draft} onChange={qa.onChange} />
          </fieldset>
        </Modal>
      )}
    </div>
  );
}
