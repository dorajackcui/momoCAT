import type { QaSeverity } from '../models';
export {
  BUILTIN_OPENAI_PROVIDER_MODELS,
  DEFAULT_PROJECT_AI_MODEL,
  getBuiltinOpenAIProviderModel,
  isBuiltinProjectAIModel,
  isLegacyProjectAIModel,
  PROJECT_AI_MODELS,
  PROJECT_AI_MODEL_SET,
  isProjectAIModel,
  normalizeProjectAIModel,
  toBuiltinProviderId,
  type BuiltinOpenAIProviderId,
  type ProjectAIModel,
} from './aiModelRegistry';
import type { ProjectAIModel } from './aiModelRegistry';

export interface ProjectFile {
  id: number;
  uuid: string;
  projectId: number;
  name: string;
  totalSegments: number;
  confirmedSegments: number;
  createdAt: string;
  updatedAt: string;
}

export type ProjectType = 'translation' | 'review' | 'custom';

export type SegmentQaRuleId = 'tag-integrity' | 'terminology-consistency';

export interface SegmentQaRuleOption {
  id: SegmentQaRuleId;
  label: string;
  description: string;
}

export interface ProjectQASettings {
  enabledRuleIds: SegmentQaRuleId[];
  instantQaOnConfirm: boolean;
}

export interface Project {
  id: number;
  uuid: string;
  name: string;
  srcLang: string;
  tgtLang: string;
  projectType?: ProjectType;
  aiPrompt?: string | null;
  aiTemperature?: number | null;
  aiModel?: ProjectAIModel | null;
  qaSettings?: ProjectQASettings | null;
  createdAt: string;
  updatedAt: string;
}

export interface FileQaIssueRecord {
  segmentId: string;
  row: number;
  ruleId: string;
  severity: QaSeverity;
  message: string;
}

export interface FileQaReport {
  fileId: number;
  checkedSegments: number;
  errorCount: number;
  warningCount: number;
  issues: FileQaIssueRecord[];
}

export const SEGMENT_QA_RULE_OPTIONS: SegmentQaRuleOption[] = [
  {
    id: 'tag-integrity',
    label: 'Tag Integrity',
    description: 'Check missing/extra/out-of-order tags.',
  },
  {
    id: 'terminology-consistency',
    label: 'Terminology Consistency',
    description: 'Check TB preferred terms in target text.',
  },
];

export const DEFAULT_PROJECT_QA_SETTINGS: ProjectQASettings = {
  enabledRuleIds: ['tag-integrity', 'terminology-consistency'],
  instantQaOnConfirm: true,
};
