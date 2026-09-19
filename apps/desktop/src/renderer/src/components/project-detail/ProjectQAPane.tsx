import { SEGMENT_QA_RULE_OPTIONS } from '@cat/core/project';
import type { ProjectQAController } from '../../hooks/projectDetail/useProjectQASettings';
import { Checkbox } from '../ui';

export function ProjectQAPane({ qa }: { qa: ProjectQAController }) {
  return (
    <div className="divide-y divide-border-subtle">
      {SEGMENT_QA_RULE_OPTIONS.map((rule) => {
        const checked = qa.draft.enabledRuleIds.includes(rule.id);
        return (
          <label key={rule.id} className="flex cursor-pointer items-start gap-3 py-4 first:pt-0">
            <Checkbox
              checked={checked}
              className="mt-0.5"
              onChange={() =>
                qa.onChange({
                  ...qa.draft,
                  enabledRuleIds: checked
                    ? qa.draft.enabledRuleIds.filter((id) => id !== rule.id)
                    : [...qa.draft.enabledRuleIds, rule.id],
                })
              }
            />
            <span>
              <span className="block text-sm font-medium text-text">{rule.label}</span>
              <span className="block text-xs text-text-muted">{rule.description}</span>
            </span>
          </label>
        );
      })}
      <label className="flex cursor-pointer items-start gap-3 py-4">
        <Checkbox
          checked={qa.draft.instantQaOnConfirm}
          className="mt-0.5"
          onChange={(event) =>
            qa.onChange({
              ...qa.draft,
              instantQaOnConfirm: event.target.checked,
            })
          }
        />
        <span>
          <span className="block text-sm font-medium text-text">Instant QA on Confirm</span>
          <span className="block text-xs text-text-muted">
            Run selected rules when confirming a segment.
          </span>
        </span>
      </label>
    </div>
  );
}
