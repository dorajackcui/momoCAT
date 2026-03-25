import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProjectAIModel, ProjectType } from '@cat/core/project';
import type { AIBatchMode, AIBatchTargetScope, JobProgressEvent } from '../../../../../shared/ipc';
import { apiClient } from '../../../services/apiClient';
import { feedbackService } from '../../../services/feedbackService';
import {
  DEFAULT_AI_TEMPERATURE,
  DEFAULT_PROJECT_AI_MODEL,
  buildAITestMeta,
  deriveProjectAIFlags,
  formatTemperature,
  normalizeProjectAIModel,
  parseTemperatureInput,
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
  const [modelDraft, setModelDraft] = useState<ProjectAIModel>(DEFAULT_PROJECT_AI_MODEL);
  const [savedModelValue, setSavedModelValue] = useState<ProjectAIModel>(DEFAULT_PROJECT_AI_MODEL);
  const [temperatureDraft, setTemperatureDraft] = useState(
    formatTemperature(DEFAULT_AI_TEMPERATURE),
  );
  const [savedTemperatureValue, setSavedTemperatureValue] = useState(
    formatTemperature(DEFAULT_AI_TEMPERATURE),
  );
  const [promptSavedAt, setPromptSavedAt] = useState<string | null>(null);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [testSource, setTestSource] = useState('');
  const [testContext, setTestContext] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testPromptUsed, setTestPromptUsed] = useState<string | null>(null);
  const [testUserMessage, setTestUserMessage] = useState<string | null>(null);
  const [testMeta, setTestMeta] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testRawResponse, setTestRawResponse] = useState<string | null>(null);
  const [showTestDetails, setShowTestDetails] = useState(false);
  const [aiJobs, setAiJobs] = useState<Record<string, TrackedAIJob>>({});
  const [fileJobIndex, setFileJobIndex] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!project) return;
    const promptValue = project.aiPrompt || '';
    const modelValue = normalizeProjectAIModel(project.aiModel);
    const temperatureValue =
      typeof project.aiTemperature === 'number' && Number.isFinite(project.aiTemperature)
        ? formatTemperature(project.aiTemperature)
        : formatTemperature(DEFAULT_AI_TEMPERATURE);

    setPromptDraft(promptValue);
    setSavedPromptValue(promptValue);
    setModelDraft(modelValue);
    setSavedModelValue(modelValue);
    setTemperatureDraft(temperatureValue);
    setSavedTemperatureValue(temperatureValue);
  }, [project]);

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
    temperatureDraft,
    savedTemperatureValue,
    modelDraft,
    savedModelValue,
    testMeta,
    testUserMessage,
    testPromptUsed,
    testRawResponse,
  });
  const normalizedPromptDraft = aiFlags.normalizedPromptDraft;
  const normalizedSavedPrompt = aiFlags.normalizedSavedPrompt;
  const normalizedSavedTemperature = aiFlags.normalizedSavedTemperature;
  const hasUnsavedPromptChanges = aiFlags.hasUnsavedPromptChanges;
  const hasInvalidTemperature = aiFlags.hasInvalidTemperature;
  const hasTestDetails = aiFlags.hasTestDetails;

  const savePrompt = useCallback(async () => {
    if (!project) return;
    const parsedTemperature = parseTemperatureInput(temperatureDraft);
    if (parsedTemperature === null) {
      feedbackService.error('Temperature must be a number between 0 and 2.');
      return;
    }

    if (
      normalizedPromptDraft === normalizedSavedPrompt &&
      normalizedSavedTemperature !== null &&
      parsedTemperature === normalizedSavedTemperature &&
      modelDraft === savedModelValue
    ) {
      return;
    }

    setSavingPrompt(true);
    try {
      await runMutation(async () => {
        const promptValue = normalizedPromptDraft.length > 0 ? normalizedPromptDraft : null;
        await apiClient.updateProjectAISettings(
          project.id,
          promptValue,
          parsedTemperature,
          modelDraft,
        );
        setProject((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            aiPrompt: promptValue,
            aiTemperature: parsedTemperature,
            aiModel: modelDraft,
          };
        });
        setSavedPromptValue(normalizedPromptDraft);
        setSavedModelValue(modelDraft);
        const normalizedTemperature = formatTemperature(parsedTemperature);
        setTemperatureDraft(normalizedTemperature);
        setSavedTemperatureValue(normalizedTemperature);
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
    normalizedSavedTemperature,
    project,
    runMutation,
    savedModelValue,
    setProject,
    temperatureDraft,
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
      setTestPromptUsed(null);
      setTestUserMessage(null);
      setTestRawResponse(null);

      const result = await apiClient.aiTestTranslate(
        project.id,
        source,
        testContext.trim() || undefined,
      );
      setTestResult(result.translatedText || null);
      setTestPromptUsed(result.promptUsed);
      setTestUserMessage(result.userMessage);
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
      modelDraft,
      setModelDraft,
      promptDraft,
      setPromptDraft,
      temperatureDraft,
      setTemperatureDraft,
      promptSavedAt,
      savingPrompt,
      testSource,
      setTestSource,
      testContext,
      setTestContext,
      testResult,
      testPromptUsed,
      testUserMessage,
      testMeta,
      testError,
      testRawResponse,
      showTestDetails,
      setShowTestDetails,
      hasUnsavedPromptChanges,
      hasInvalidTemperature,
      hasTestDetails,
      savePrompt,
      testPrompt,
      startAITranslateFile,
      getFileJob,
    }),
    [
      getFileJob,
      hasInvalidTemperature,
      hasTestDetails,
      hasUnsavedPromptChanges,
      modelDraft,
      promptDraft,
      promptSavedAt,
      savePrompt,
      savingPrompt,
      showTestDetails,
      startAITranslateFile,
      temperatureDraft,
      testContext,
      testError,
      testMeta,
      testPrompt,
      testPromptUsed,
      testRawResponse,
      testResult,
      testSource,
      testUserMessage,
    ],
  );
}
