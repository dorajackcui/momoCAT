import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project, ProjectAIModel, ProjectType } from '@cat/core/project';
import type {
  AIBatchMode,
  AIBatchTargetScope,
  AIProviderSummary,
  JobProgressEvent,
} from '../../../../../shared/ipc';
import { apiClient } from '../../../services/apiClient';
import { AI_PROVIDERS_CHANGED_EVENT } from '../../../services/aiProviderEvents';
import { feedbackService } from '../../../services/feedbackService';
import {
  DEFAULT_PROJECT_AI_MODEL,
  buildAITestMeta,
  buildProjectAISystemPromptPreview,
  deriveProjectAIFlags,
  normalizeProjectAIProviderSelection,
} from './aiSettingsHelpers';
import { upsertTrackedJobFromProgress, upsertTrackedJobOnStart } from './aiJobTracker';
import type {
  ProjectAIController,
  StartAITranslateFileOptions,
  TrackedAIJob,
  UseProjectAIParams,
} from './types';

export interface ResolvedAITranslateStartConfig {
  effectiveMode: AIBatchMode;
  effectiveTargetScope: AIBatchTargetScope;
  actionLabel: string;
  targetLabel: string;
}

export function resolveAITranslateStartConfig(params: {
  projectType: ProjectType | undefined;
  options: StartAITranslateFileOptions;
}): ResolvedAITranslateStartConfig {
  const projectType = params.projectType || 'translation';
  const effectiveMode: AIBatchMode =
    projectType === 'translation' ? params.options.mode || 'default' : 'default';
  const effectiveTargetScope: AIBatchTargetScope =
    projectType === 'translation' ? params.options.targetScope || 'blank-only' : 'blank-only';
  const actionLabel =
    projectType === 'review'
      ? 'review'
      : projectType === 'custom'
        ? 'processing'
        : effectiveMode === 'dialogue'
          ? 'dialogue translation'
          : 'translation';

  return {
    effectiveMode,
    effectiveTargetScope,
    actionLabel,
    targetLabel: projectType === 'custom' ? 'output' : 'target',
  };
}

export function buildAIStartConfirmMessage(
  fileName: string,
  config: ResolvedAITranslateStartConfig,
): string {
  const scopeLabel =
    config.effectiveTargetScope === 'overwrite-non-confirmed'
      ? `overwrite existing non-confirmed ${config.targetLabel} segments`
      : `fill empty ${config.targetLabel} segments only`;
  return `Run AI ${config.actionLabel} for "${fileName}"? This will ${scopeLabel}.`;
}

export function useProjectAI({
  project,
  setProject,
  loadData,
  runMutation,
}: UseProjectAIParams): ProjectAIController {
  const [promptDraft, setPromptDraft] = useState('');
  const [savedPromptValue, setSavedPromptValue] = useState('');
  const [providerOptions, setProviderOptions] = useState<AIProviderSummary[]>([]);
  const [modelDraft, setModelDraft] = useState<ProjectAIModel>(DEFAULT_PROJECT_AI_MODEL);
  const [savedModelValue, setSavedModelValue] = useState<ProjectAIModel>(DEFAULT_PROJECT_AI_MODEL);
  const [promptSavedAt, setPromptSavedAt] = useState<string | null>(null);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [testSource, setTestSource] = useState('');
  const [testContext, setTestContext] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testSystemPrompt, setTestSystemPrompt] = useState<string | null>(null);
  const [testUserPrompt, setTestUserPrompt] = useState<string | null>(null);
  const [testMeta, setTestMeta] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testRawResponse, setTestRawResponse] = useState<string | null>(null);
  const [showTestDetails, setShowTestDetails] = useState(false);
  const [aiJobs, setAiJobs] = useState<Record<string, TrackedAIJob>>({});
  const [fileJobIndex, setFileJobIndex] = useState<Record<number, string>>({});

  const loadProviders = useCallback(async () => {
    try {
      const providers = await apiClient.listAIProviders();
      setProviderOptions(providers);
    } catch {
      setProviderOptions([]);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
    const handleProvidersChanged = () => {
      void loadProviders();
    };
    window.addEventListener(AI_PROVIDERS_CHANGED_EVENT, handleProvidersChanged);
    return () => window.removeEventListener(AI_PROVIDERS_CHANGED_EVENT, handleProvidersChanged);
  }, [loadProviders]);

  useEffect(() => {
    if (!project) return;
    const promptValue = project.aiPrompt || '';
    const modelValue = normalizeProjectAIProviderSelection(project.aiModel, providerOptions);

    setPromptDraft(promptValue);
    setSavedPromptValue(promptValue);
    setModelDraft(modelValue);
    setSavedModelValue(modelValue);
  }, [project, providerOptions]);

  useEffect(() => {
    const unsubscribe = apiClient.onJobProgress((progress: JobProgressEvent) => {
      setAiJobs((prev) => {
        const existing = prev[progress.jobId];
        const nextJob = upsertTrackedJobFromProgress(progress, existing);
        return {
          ...prev,
          [progress.jobId]: nextJob,
        };
      });

      if (progress.status === 'completed' || progress.status === 'failed') {
        void loadData();
      }
    });
    return unsubscribe;
  }, [loadData]);

  const aiFlags = deriveProjectAIFlags({
    promptDraft,
    savedPromptValue,
    modelDraft,
    savedModelValue,
    testMeta,
    testUserPrompt,
    testSystemPrompt,
    testRawResponse,
  });
  const normalizedPromptDraft = aiFlags.normalizedPromptDraft;
  const normalizedSavedPrompt = aiFlags.normalizedSavedPrompt;
  const hasUnsavedPromptChanges = aiFlags.hasUnsavedPromptChanges;
  const hasTestDetails = aiFlags.hasTestDetails;
  const effectiveSystemPromptPreview = useMemo(() => {
    if (!project) {
      return '';
    }
    return buildProjectAISystemPromptPreview({
      projectType: project.projectType,
      srcLang: project.srcLang,
      tgtLang: project.tgtLang,
      promptDraft: normalizedSavedPrompt,
    });
  }, [normalizedSavedPrompt, project]);

  const savePrompt = useCallback(async () => {
    if (!project) return;
    if (
      normalizedPromptDraft === normalizedSavedPrompt &&
      modelDraft === savedModelValue
    ) {
      return;
    }

    setSavingPrompt(true);
    try {
      await runMutation(async () => {
        const promptValue = normalizedPromptDraft.length > 0 ? normalizedPromptDraft : null;
        await apiClient.updateProjectAISettings(project.id, promptValue, modelDraft);
        setProject((prev: Project | null) => {
          if (!prev) return prev;
          return {
            ...prev,
            aiPrompt: promptValue,
            aiModel: modelDraft,
          };
        });
        setSavedPromptValue(normalizedPromptDraft);
        setSavedModelValue(modelDraft);
        setPromptSavedAt(new Date().toLocaleTimeString());
      });
    } catch {
      feedbackService.error('Failed to save AI settings');
    } finally {
      setSavingPrompt(false);
    }
  }, [
    modelDraft,
    normalizedPromptDraft,
    normalizedSavedPrompt,
    project,
    runMutation,
    savedModelValue,
    setProject,
  ]);

  const testPrompt = useCallback(async () => {
    if (!project) return;
    const source = testSource.trim();
    if (!source) {
      feedbackService.info('Please enter test source text.');
      return;
    }

    try {
      setTestError(null);
      setTestResult(null);
      setTestMeta(null);
      setTestSystemPrompt(null);
      setTestUserPrompt(null);
      setTestRawResponse(null);

      const result = await apiClient.aiTestTranslate(
        project.id,
        source,
        testContext.trim() || undefined,
      );
      setTestResult(result.translatedText || null);
      setTestSystemPrompt(result.systemPrompt);
      setTestUserPrompt(result.userPrompt);
      setTestError(result.error || null);
      setTestRawResponse(result.rawResponseText || null);

      setTestMeta(buildAITestMeta(result));
      setShowTestDetails(!result.ok);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTestError(message);
      setShowTestDetails(true);
    }
  }, [project, testContext, testSource]);

  const startAITranslateFile = useCallback(
    async (
      fileId: number,
      fileName: string,
      options: AIBatchMode | StartAITranslateFileOptions = 'default',
    ) => {
      const normalizedOptions: StartAITranslateFileOptions =
        typeof options === 'string' ? { mode: options } : options;
      const config = resolveAITranslateStartConfig({
        projectType: project?.projectType,
        options: normalizedOptions,
      });
      const shouldConfirm = normalizedOptions.confirm !== false;

      if (shouldConfirm) {
        const confirmed = await feedbackService.confirm(
          buildAIStartConfirmMessage(fileName, config),
        );
        if (!confirmed) return;
      }

      try {
        const jobId = await apiClient.aiTranslateFile(fileId, {
          mode: config.effectiveMode,
          targetScope: config.effectiveTargetScope,
        });
        setAiJobs((prev) => {
          const existing = prev[jobId];
          return {
            ...prev,
            [jobId]: upsertTrackedJobOnStart(jobId, fileId, existing),
          };
        });
        setFileJobIndex((prev) => ({ ...prev, [fileId]: jobId }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        feedbackService.error(`Failed to start AI ${config.actionLabel}: ${message}`);
      }
    },
    [project?.projectType],
  );

  const getFileJob = useCallback(
    (fileId: number): TrackedAIJob | null => {
      const jobId = fileJobIndex[fileId];
      if (!jobId) return null;
      return aiJobs[jobId] ?? null;
    },
    [aiJobs, fileJobIndex],
  );

  return useMemo(
    () => ({
      providerOptions,
      modelDraft,
      setModelDraft,
      effectiveSystemPromptPreview,
      promptDraft,
      setPromptDraft,
      promptSavedAt,
      savingPrompt,
      testSource,
      setTestSource,
      testContext,
      setTestContext,
      testResult,
      testSystemPrompt,
      testUserPrompt,
      testMeta,
      testError,
      testRawResponse,
      showTestDetails,
      setShowTestDetails,
      hasUnsavedPromptChanges,
      hasTestDetails,
      savePrompt,
      testPrompt,
      startAITranslateFile,
      getFileJob,
    }),
    [
      getFileJob,
      hasTestDetails,
      hasUnsavedPromptChanges,
      providerOptions,
      modelDraft,
      effectiveSystemPromptPreview,
      promptDraft,
      promptSavedAt,
      savePrompt,
      savingPrompt,
      showTestDetails,
      startAITranslateFile,
      testContext,
      testError,
      testMeta,
      testPrompt,
      testSystemPrompt,
      testRawResponse,
      testResult,
      testSource,
      testUserPrompt,
    ],
  );
}
