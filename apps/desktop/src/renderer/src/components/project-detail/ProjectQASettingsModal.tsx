import {
  DEFAULT_PROJECT_QA_SETTINGS,
  SEGMENT_QA_RULE_OPTIONS,
  type ProjectQASettings,
} from '@cat/core/project';
import { Button, Card, Modal } from '../ui';

interface ProjectQASettingsModalProps {
  isOpen: boolean;
  draft: ProjectQASettings;
  onChange: (next: ProjectQASettings) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}

export function ProjectQASettingsModal({
  isOpen,
  draft,
  onChange,
  onClose,
  onSave,
  saving,
}: ProjectQASettingsModalProps) {
  if (!isOpen) return null;

  const current = draft || DEFAULT_PROJECT_QA_SETTINGS;

  const toggleRule = (ruleId: (typeof SEGMENT_QA_RULE_OPTIONS)[number]['id']) => {
    const enabled = current.enabledRuleIds.includes(ruleId);
    const enabledRuleIds = enabled
      ? current.enabledRuleIds.filter((id) => id !== ruleId)
      : [...current.enabledRuleIds, ruleId];
    onChange({
      ...current,
      enabledRuleIds,
    });
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      size="lg"
      title="QA Settings"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={onSave} disabled={saving} loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {SEGMENT_QA_RULE_OPTIONS.map((rule) => {
          const checked = current.enabledRuleIds.includes(rule.id);
          return (
            <Card key={rule.id} variant="surface" className="p-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleRule(rule.id)}
                  className="mt-0.5 accent-brand"
                />
                <span>
                  <span className="block text-sm font-semibold text-text">{rule.label}</span>
                  <span className="block text-xs text-text-muted">{rule.description}</span>
                </span>
              </label>
            </Card>
          );
        })}
      </div>

      <Card variant="subtle" className="p-3">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={current.instantQaOnConfirm}
            onChange={(e) =>
              onChange({
                ...current,
                instantQaOnConfirm: e.target.checked,
              })
            }
            className="mt-0.5 accent-brand"
          />
          <span>
            <span className="block text-sm font-semibold text-text">Instant QA on Confirm</span>
            <span className="block text-xs text-text-muted">
              Run selected QA rules when confirming a segment in the editor.
            </span>
          </span>
        </label>
      </Card>
    </Modal>
  );
}
