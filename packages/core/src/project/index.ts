import type { QaIssue } from '../models';
export {
  DEFAULT_PROJECT_AI_MODEL,
  isProjectAIModel,
  normalizeProjectAIModel,
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

export type ProjectType = 'translation' | 'custom';

import type { ProjectQASettings } from './qaSettings';
export * from './qaSettings';

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

export interface FileQaIssueRecord extends QaIssue {
  segmentId: string;
  row: number;
}

export interface FileQaReport {
  fileId: number;
  /** Input changed during evaluation; findings were not persisted. */
  stale?: boolean;
  checkedSegments: number;
  issues: FileQaIssueRecord[];
  issueCount: number;
  affectedSegments: number;
}

export {
  buildAISystemPrompt,
  buildAITextPromptBundle,
  buildAIUserPrompt,
  normalizeProjectType,
} from './aiPromptTemplates';
export { buildAIWindowModePromptBundle, parseAIWindowModeResponse } from './windowModePrompt';
export {
  DEFAULT_SOURCE_TERMINOLOGY_SELECTION_PROMPT,
  buildSourceTerminologyPromptBundle,
  parseSourceTerminologyResponse,
} from './sourceTerminologyPrompt';
export type {
  ParsedSourceTerminologySegment,
  SourceTerminologyPromptBuildParams,
  SourceTerminologyPromptBundle,
  SourceTerminologyPromptHistoricalTerm,
  SourceTerminologyPromptUnit,
} from './sourceTerminologyPrompt';
export type {
  PromptConcordanceReference,
  PromptTBReference,
  PromptTMReference,
  SystemPromptBuildParams,
  TextPromptBundle,
  TextPromptBundleBuildParams,
  TextPromptSections,
  UserPromptBuildParams,
} from './aiPromptTypes';
export type {
  WindowModeCurrentSegment,
  WindowModeNextContextRow,
  WindowModeParsedTranslation,
  WindowModePreviousContextRow,
  WindowModePromptBundle,
  WindowModePromptBundleBuildParams,
  WindowModePromptSections,
} from './windowModePromptTypes';
