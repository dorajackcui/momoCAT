export const QA_RULE_GROUPS = [
  {
    id: 'empty-target',
    label: 'Empty target',
    checks: [['empty-target', 'Empty or whitespace-only target']],
  },
  {
    id: 'terminology-consistency',
    label: 'Terminology',
    checks: [
      ['tb-term-missing', 'Preferred translation'],
      ['term-mark-count', 'Missing term pairs'],
      ['term-conflict', 'Conflicting marked translations'],
    ],
  },
  {
    id: 'source-consistency',
    label: 'Same source, different targets',
    checks: [['source-consistency', 'Translation variants']],
  },
  {
    id: 'target-consistency',
    label: 'Same target, different sources',
    checks: [['target-consistency', 'Source variants']],
  },
  {
    id: 'substring-consistency',
    label: 'Substring translation consistency',
    checks: [['substring-consistency', 'Missing reference translation']],
  },
  {
    id: 'tag-integrity',
    label: 'Tag / Placeholder',
    checks: [
      ['tag-missing', 'Missing tags'],
      ['tag-extra', 'Extra tags'],
      ['tag-count', 'Different counts'],
      ['tag-structure', 'Closing and nesting'],
      ['tag-order', 'Tag order'],
    ],
  },
  {
    id: 'line-break',
    label: 'Line breaks',
    checks: [['line-break', 'Different line break counts']],
  },
  { id: 'number', label: 'Numbers', checks: [['number', 'Missing or changed numbers']] },
  { id: 'url', label: 'URLs', checks: [['url', 'Missing or changed URLs']] },
  {
    id: 'chinese',
    label: 'Chinese in target',
    checks: [['chinese', 'Chinese characters and punctuation']],
  },
  {
    id: 'target-text',
    label: 'Target text',
    checks: [
      ['abnormal-punctuation', 'Repeated punctuation'],
      ['consecutive-spaces', 'Consecutive spaces'],
      ['leading-trailing-spaces', 'Leading / trailing spaces'],
      ['mixed-width', 'Mixed full / half width'],
      ['paired-symbols', 'Paired brackets and quotes'],
    ],
  },
] as const;

export type SegmentQaRuleId = (typeof QA_RULE_GROUPS)[number]['id'];
export type QaCheckId = (typeof QA_RULE_GROUPS)[number]['checks'][number][0];

export const QA_OPTIONAL_CHECK_IDS: readonly QaCheckId[] = [
  'tag-order',
  'abnormal-punctuation',
  'consecutive-spaces',
  'leading-trailing-spaces',
  'mixed-width',
  'paired-symbols',
];
export const QA_TAG_TYPES = ['angle', 'brace', 'color', 'newline'] as const;
export type QaTagType = (typeof QA_TAG_TYPES)[number];

export interface ProjectQASettings {
  enabledRuleIds: SegmentQaRuleId[];
  instantQaOnConfirm: boolean;
  disabledCheckIds?: QaCheckId[];
  options?: {
    /** @deprecated Accepted at the settings boundary; file import policy selects tag handling. */
    tagMode?: 'standard' | 'memoq';
    tagTypes?: QaTagType[];
    termMarks?: Array<'square' | 'corner'>;
    substringMinCjk?: number;
    substringMinOther?: number;
    ignoredTags?: string[];
  };
}

export const DEFAULT_PROJECT_QA_SETTINGS: ProjectQASettings = {
  enabledRuleIds: QA_RULE_GROUPS.map((group) => group.id).filter(
    (id) => !['target-consistency', 'substring-consistency', 'chinese'].includes(id),
  ),
  disabledCheckIds: ['tag-order'],
  instantQaOnConfirm: true,
  options: {
    tagTypes: [...QA_TAG_TYPES],
    termMarks: ['square', 'corner'],
    substringMinCjk: 3,
    substringMinOther: 2,
    ignoredTags: [],
  },
};

export const SEGMENT_QA_RULE_OPTIONS = QA_RULE_GROUPS.map((group) => ({
  id: group.id,
  label: group.label,
  description: group.checks.map((check) => check[1]).join(', '),
}));

export function normalizeQASettings(value?: Partial<ProjectQASettings> | null): ProjectQASettings {
  const defaults = DEFAULT_PROJECT_QA_SETTINGS;
  const options = { ...defaults.options };
  for (const key of Object.keys(options) as Array<
    keyof NonNullable<ProjectQASettings['options']>
  >) {
    const candidate = value?.options?.[key];
    if (candidate !== undefined && isQASettings({ ...defaults, options: { [key]: candidate } })) {
      Object.assign(options, { [key]: Array.isArray(candidate) ? [...candidate] : candidate });
    }
  }
  return {
    enabledRuleIds: Array.isArray(value?.enabledRuleIds)
      ? [
          ...new Set(
            value.enabledRuleIds.filter((id) => QA_RULE_GROUPS.some((group) => group.id === id)),
          ),
        ]
      : [...defaults.enabledRuleIds],
    instantQaOnConfirm:
      typeof value?.instantQaOnConfirm === 'boolean'
        ? value.instantQaOnConfirm
        : defaults.instantQaOnConfirm,
    disabledCheckIds: Array.isArray(value?.disabledCheckIds)
      ? value.disabledCheckIds.filter((id) => QA_OPTIONAL_CHECK_IDS.includes(id))
      : [...defaults.disabledCheckIds!],
    options,
  };
}

export function isQaCheckEnabled(settings: ProjectQASettings, checkId: string): boolean {
  const group = QA_RULE_GROUPS.find((item) => item.checks.some((check) => check[0] === checkId));
  return Boolean(
    group &&
    settings.enabledRuleIds.includes(group.id) &&
    (!QA_OPTIONAL_CHECK_IDS.includes(checkId as QaCheckId) ||
      !settings.disabledCheckIds?.includes(checkId as QaCheckId)),
  );
}

export function qaGroupForRule(ruleId: string) {
  return QA_RULE_GROUPS.find((group) => group.checks.some((check) => check[0] === ruleId));
}

export function isQASettings(value: unknown): value is ProjectQASettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as ProjectQASettings;
  if (
    typeof settings.instantQaOnConfirm !== 'boolean' ||
    !Array.isArray(settings.enabledRuleIds) ||
    !Array.from(settings.enabledRuleIds).every((id) =>
      QA_RULE_GROUPS.some((group) => group.id === id),
    )
  )
    return false;
  if (
    settings.disabledCheckIds !== undefined &&
    (!Array.isArray(settings.disabledCheckIds) ||
      !Array.from(settings.disabledCheckIds).every((id) =>
        QA_RULE_GROUPS.some((group) => group.checks.some((check) => check[0] === id)),
      ))
  )
    return false;
  if (settings.options === undefined) return true;
  const options = settings.options;
  if (!options || typeof options !== 'object' || Array.isArray(options)) return false;
  return (
    (options.tagMode === undefined || ['standard', 'memoq'].includes(options.tagMode)) &&
    (options.tagTypes === undefined ||
      (Array.isArray(options.tagTypes) &&
        Array.from(options.tagTypes).every((type) => QA_TAG_TYPES.includes(type)))) &&
    (options.termMarks === undefined ||
      (Array.isArray(options.termMarks) &&
        Array.from(options.termMarks).every((mark) => ['square', 'corner'].includes(mark)))) &&
    [options.substringMinCjk, options.substringMinOther].every(
      (value) => value === undefined || (Number.isInteger(value) && value >= 1 && value <= 1000000),
    ) &&
    (options.ignoredTags === undefined ||
      (Array.isArray(options.ignoredTags) &&
        Array.from(options.ignoredTags).every((tag) => typeof tag === 'string')))
  );
}
