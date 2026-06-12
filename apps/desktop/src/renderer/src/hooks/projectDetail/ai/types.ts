import type { Dispatch, SetStateAction } from 'react';
import type { Project, ProjectAIModel } from '@cat/core/project';
import type {
  AIBatchMode,
  AIBatchTargetBaseline,
  AIBatchTargetScope,
  AIProviderSummary,
} from '../../../../../shared/ipc';
import type { AIFileJob, AIFileJobTracker } from '../../aiFileJobs';

export interface ProjectAIFlagsInput {
  promptDraft: string;
  savedPromptValue: string;
  modelDraft: ProjectAIModel;
  savedModelValue: ProjectAIModel;
  testMeta: string | null;
  testUserPrompt: string | null;
  testSystemPrompt: string | null;
  testRawResponse: string | null;
}

export interface ProjectAIFlags {
  normalizedPromptDraft: string;
  normalizedSavedPrompt: string;
  hasUnsavedPromptChanges: boolean;
  hasTestDetails: boolean;
}

export interface AITestMetaInput {
  status?: number;
  requestId?: string;
  model?: string;
  endpoint?: string;
  ok: boolean;
}

export type TrackedAIJob = AIFileJob;

export interface StartAITranslateFileOptions {
  mode?: AIBatchMode;
  targetScope?: AIBatchTargetScope;
  targetBaseline?: AIBatchTargetBaseline;
  confirm?: boolean;
}

export interface ProjectAIController {
  providerOptions: AIProviderSummary[];
  modelDraft: ProjectAIModel;
  setModelDraft: Dispatch<SetStateAction<ProjectAIModel>>;
  providerUnavailable: boolean;
  providerSetupRequired: boolean;
  providerWarning: string | null;
  effectiveSystemPromptPreview: string;
  promptDraft: string;
  setPromptDraft: Dispatch<SetStateAction<string>>;
  promptSavedAt: string | null;
  savingPrompt: boolean;
  testSource: string;
  setTestSource: Dispatch<SetStateAction<string>>;
  testContext: string;
  setTestContext: Dispatch<SetStateAction<string>>;
  testResult: string | null;
  testSystemPrompt: string | null;
  testUserPrompt: string | null;
  testMeta: string | null;
  testError: string | null;
  testRawResponse: string | null;
  showTestDetails: boolean;
  setShowTestDetails: Dispatch<SetStateAction<boolean>>;
  hasUnsavedPromptChanges: boolean;
  hasTestDetails: boolean;
  savePrompt: () => Promise<void>;
  testPrompt: () => Promise<void>;
  startAITranslateFile: (
    fileId: number,
    fileName: string,
    options?: AIBatchMode | StartAITranslateFileOptions,
  ) => Promise<void>;
  getFileJob: (fileId: number) => TrackedAIJob | null;
}

export interface UseProjectAIParams {
  project: Project | null;
  setProject: Dispatch<SetStateAction<Project | null>>;
  loadData: () => Promise<void>;
  runMutation: <T>(fn: () => Promise<T>) => Promise<T>;
  fileJobTracker: AIFileJobTracker;
}
