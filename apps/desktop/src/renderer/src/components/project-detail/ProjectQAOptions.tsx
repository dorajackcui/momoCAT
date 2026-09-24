import {
  QA_RULE_GROUPS,
  type ProjectQASettings,
  type QaCheckId,
  type QaTagType,
  type SegmentQaRuleId,
} from '@cat/core/project';
import { Checkbox, Input, Textarea } from '../ui';

export const QA_OPTIONS_GROUPS: readonly SegmentQaRuleId[] = [
  'terminology-consistency',
  'substring-consistency',
  'tag-integrity',
  'target-text',
];
const tagTypes: Array<[QaTagType, string]> = [
  ['angle', '<…> tags'],
  ['color', '[color=…] tags'],
  ['brace', '{…} placeholders'],
  ['newline', '\\n markers'],
];

export function ProjectQAOptions({
  groupId,
  draft,
  onChange,
}: {
  groupId: SegmentQaRuleId;
  draft: ProjectQASettings;
  onChange: (settings: ProjectQASettings) => void;
}) {
  const options = draft.options!;
  const updateOptions = (update: Partial<typeof options>) =>
    onChange({ ...draft, options: { ...options, ...update } });
  const check = (id: QaCheckId, label: string) => (
    <label key={id} className="flex items-center gap-2 text-sm">
      <Checkbox
        checked={!draft.disabledCheckIds!.includes(id)}
        onChange={() =>
          onChange({
            ...draft,
            disabledCheckIds: draft.disabledCheckIds!.includes(id)
              ? draft.disabledCheckIds!.filter((item) => item !== id)
              : [...draft.disabledCheckIds!, id],
          })
        }
      />
      {label}
    </label>
  );

  if (groupId === 'terminology-consistency')
    return (
      <div className="space-y-2">
        <span className="text-xs text-text-muted">Term marks</span>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {(['corner', 'square'] as const).map((mark) => (
            <label key={mark} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={options.termMarks!.includes(mark)}
                onChange={() =>
                  updateOptions({
                    termMarks: options.termMarks!.includes(mark)
                      ? options.termMarks!.filter((item) => item !== mark)
                      : [...options.termMarks!, mark],
                  })
                }
              />
              {mark === 'square' ? '[ ] / ［ ］' : '【 】'}
            </label>
          ))}
        </div>
      </div>
    );

  if (groupId === 'substring-consistency')
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(['substringMinCjk', 'substringMinOther'] as const).map((key) => (
          <label key={key} className="space-y-1 text-sm">
            <span>
              {key === 'substringMinCjk' ? 'Minimum CJK letters' : 'Minimum other letters'}
            </span>
            <Input
              type="number"
              min={1}
              max={1000000}
              value={options[key]}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isInteger(value) && value >= 1 && value <= 1000000)
                  updateOptions({ [key]: value });
              }}
            />
          </label>
        ))}
      </div>
    );

  if (groupId === 'tag-integrity')
    return (
      <div className="space-y-3">
        <p className="text-xs text-text-muted">Only for Plain marker-like text files</p>
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {tagTypes.map(([id, label]) => (
            <label key={id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={options.tagTypes!.includes(id)}
                onChange={() =>
                  updateOptions({
                    tagTypes: options.tagTypes!.includes(id)
                      ? options.tagTypes!.filter((item) => item !== id)
                      : [...options.tagTypes!, id],
                  })
                }
              />
              {label}
            </label>
          ))}
        </div>
        {check('tag-order', 'Check tag order')}
        <label className="block space-y-1 text-sm">
          <span>Ignored tags (exact text, one per line)</span>
          <Textarea
            rows={2}
            value={options.ignoredTags!.join('\n')}
            onChange={(event) => updateOptions({ ignoredTags: event.target.value.split('\n') })}
          />
        </label>
      </div>
    );

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {QA_RULE_GROUPS.find((group) => group.id === 'target-text')!.checks.map(([id, label]) =>
        check(id, label),
      )}
    </div>
  );
}
