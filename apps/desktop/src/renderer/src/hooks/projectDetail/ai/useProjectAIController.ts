import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project, ProjectAIModel, ProjectType } from '@cat/core/project';
import type {
  AIBatchMode,
  AIBatchTargetBaseline,
  AIProviderSummary,
} from '../../../../../shared/ipc';
import { apiClient } from '../../../services/apiClient';
import { AI_PROVIDERS_CHANGED_EVENT } from '../../../services/aiProviderEvents';
import { feedbackService } from '../../../services/feedbackService';
import {
  DEFAULT_PROJECT_AI_MODEL,
  buildAITestMeta,
  buildProjectAISystemPromptPreview,
  deriveProjectAIProviderAvailability,
  deriveProjectAIProviderDraftsAfterProviderOptionsChange,
  deriveProjectAIFlags,
  getProjectAIProviderActionBlockMessage,
  normalizeProjectAIProviderPersistenceValue,
  normalizeProjectAIProviderSelection,
} from './aiSettingsHelpers';
import type {
  ProjectAIController,
  StartAITranslateFileOptions,
  UseProjectAIParams,
} from './types';

export interface ResolvedAITranslateStartConfig {
  effectiveMode: AIBatchMode;
  effectiveTargetBaseline: AIBatchTargetBaseline;
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
  const effectiveTargetBaseline: AIBatchTargetBaseline =
    projectType === 'translation'
      ? resolveTargetBaseline(params.options)
      : 'use-current-targets';
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
    effectiveTargetBaseline,
    actionLabel,
    targetLabel: projectType === 'custom' ? 'output' : 'target',
  };
}

export function buildAIStartConfirmMessage(
  fileName: string,
  config: ResolvedAITranslateStartConfig,
): string {
  const baselineLabel =
    config.effectiveTargetBaseline === 'ignore-current-targets'
      ? `ignore existing non-confirmed ${config.targetLabel} segments and regenerate them`
      : `use current ${config.targetLabel} segments and fill blanks`;
  return `Run AI ${config.actionLabel} for "${fileName}"? This will ${baselineLabel}.`;
}

function resolveTargetBaseline(options: StartAITranslateFileOptions): AIBatchTargetBaseline {
  if (options.targetBaseline) {
    return options.targetBaseline;
  }

  return options.targetScope === 'overwrite-non-confirmed'
    ? 'ignore-current-targets'
    : 'use-current-targets';
}

export function useProjectAI({
  project,
  setProject,
  loadData,
  runMutation,
  fileJobTracker,
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
    const modelValue = normalizeProjectAIProviderSelection(project.aiModel, []);

    setPromptDraft(promptValue);
    setSavedPromptValue(promptValue);
    setModelDraft(modelValue);
    setSavedModelValue(modelValue);
  }, [project?.aiModel, project?.aiPrompt, project?.id]);

  useEffect(() => {
    if (!project) return;
    const nextDrafts = deriveProjectAIProviderDraftsAfterProviderOptionsChange({
      projectAIModel: project.aiModel,
      modelDraft,
      savedModelValue,
      providerOptions,
    });
    if (nextDrafts.modelDraft !== modelDraft) {
      setModelDraft(nextDrafts.modelDraft);
    }
    if (nextDrafts.savedModelValue !== savedModelValue) {
      setSavedModelValue(nextDrafts.savedModelValue);
    }
  }, [modelDraft, project?.aiModel, project?.id, providerOptions, savedModelValue]);

  useEffect(() => {
    const unsubscribe = apiClient.onJobProgress((progress) => {
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
  const providerAvailability = useMemo(
    () => deriveProjectAIProviderAvailability(modelDraft, providerOptions),
    [modelDraft, providerOptions],
  );
  const providerActionBlockMessage = getProjectAIProviderActionBlockMessage(providerAvailability);
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
        const providerValue = normalizeProjectAIProviderPersistenceValue(modelDraft);
        await apiClient.updateProjectAISettings(project.id, promptValue, providerValue);
        setProject((prev: Project | null) => {
          if (!prev) return prev;
          return {
            ...prev,
            aiPrompt: promptValue,
            aiModel: providerValue,
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
    if (providerActionBlockMessage) {
      feedbackService.info(providerActionBlockMessage);
      return;
    }
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
  }, [project, providerActionBlockMessage, testContext, testSource]);

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
      if (providerActionBlockMessage) {
        feedbackService.info(providerActionBlockMessage);
        return;
      }

      if (shouldConfirm) {
        const confirmed = await feedbackService.confirm(
          buildAIStartConfirmMessage(fileName, config),
        );
        if (!confirmed) return;
      }

      try {
        const jobId = await apiClient.aiTranslateFile(fileId, {
          mode: config.effectiveMode,
          targetBaseline: config.effectiveTargetBaseline,
        });
        fileJobTracker.trackFileJobStart(fileId, jobId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        feedbackService.error(`Failed to start AI ${config.actionLabel}: ${message}`);
      }
    },
    [fileJobTracker, project?.projectType, providerActionBlockMessage],
  );

  return useMemo(
    () => ({
      providerOptions,
      modelDraft,
      setModelDraft,
      providerUnavailable: providerAvailability.providerUnavailable,
      providerSetupRequired: providerAvailability.providerSetupRequired,
      providerWarning: providerAvailability.providerWarning,
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
      getFileJob: fileJobTracker.getFileJob,
    }),
    [
      fileJobTracker,
      hasTestDetails,
      hasUnsavedPromptChanges,
      providerAvailability.providerSetupRequired,
      providerAvailability.providerUnavailable,
      providerAvailability.providerWarning,
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
