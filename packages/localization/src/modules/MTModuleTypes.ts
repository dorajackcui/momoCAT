import type { Segment } from '@cat/core/models';
import type {
  Project,
  WindowModeNextContextRow,
  WindowModePreviousContextRow,
} from '@cat/core/project';
import type { TagValidator } from '@cat/core/qa';
import type { TagPolicy } from '@cat/core/tag';
import type {
  AIProviderCatalogService,
  ResolvedAIProviderConfig,
} from '../providers/AIProviderCatalogService';
import type { AIRuntimeConfigProvider, AITransport, ReasoningEffort } from '../ports';
import type { PromptArtifact, TBArtifact, TMArtifact } from '../artifacts';
import type { MTModuleOptions as LocalizationMTOptions } from '../types';

export interface MTModuleDependencies {
  providerCatalogService: Pick<AIProviderCatalogService, 'listProviders' | 'resolveProviderConfig'>;
  aiRuntimeConfigProvider: AIRuntimeConfigProvider;
  aiTransport: AITransport;
  tagValidator?: TagValidator;
}

export interface ComposePromptInput {
  unitId: string;
  project: Project;
  segment: Segment;
  tm: TMArtifact;
  tb: TBArtifact;
  tagPolicy?: TagPolicy;
  mtOptions?: LocalizationMTOptions;
  providerOverride?: string;
  projectPromptOverride?: string;
}

export interface MTBatchCurrentUnitInput {
  responseId: string;
  documentId: string;
  unitId: string;
  segment: Segment;
  tm: TMArtifact;
  tb: TBArtifact;
  context?: string;
}

export interface ComposeBatchPromptInput {
  taskId: string;
  project: Project;
  requestMode?: 'window' | 'window-partial';
  current: MTBatchCurrentUnitInput[];
  previousContext: WindowModePreviousContextRow[];
  nextContext: WindowModeNextContextRow[];
  readOnlyContextRows?: Array<{
    role: 'previous' | 'current-existing' | 'next';
    source: string;
    target?: string;
    rowNumber?: number;
  }>;
  scanWindowCount?: number;
  tagPolicy?: TagPolicy;
  mtOptions?: LocalizationMTOptions;
  providerOverride?: string;
  projectPromptOverride?: string;
}

export interface ResolvedMTConfig {
  provider: ResolvedAIProviderConfig['provider'];
  apiKey: string;
  model: string;
  reasoningEffort: ReasoningEffort;
}

export interface PromptMTConfig {
  provider: ResolvedAIProviderConfig['provider'];
  model: string;
  reasoningEffort: ReasoningEffort;
}

export interface PreparedPromptInput extends ComposePromptInput {
  baseUrl: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  srcLang: string;
  tgtLang: string;
  provider?: ResolvedAIProviderConfig['provider'];
  validationFeedback?: string;
}

export interface PreparedBatchPromptInput extends ComposeBatchPromptInput {
  baseUrl: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  srcLang: string;
  tgtLang: string;
  provider?: ResolvedAIProviderConfig['provider'];
  validationFeedback?: string;
}

export interface TranslatePreparedPromptInput extends PreparedPromptInput {
  apiKey: string;
}

export interface TranslatePreparedBatchPromptInput extends PreparedBatchPromptInput {
  apiKey: string;
}

export interface MTTranslateResult {
  targetTokens: Segment['targetTokens'];
  prompt: PromptArtifact;
}

export interface MTBatchUnitResult {
  documentId: string;
  unitId: string;
  responseId: string;
  targetTokens: Segment['targetTokens'];
}

export interface MTBatchTranslateResult {
  results: MTBatchUnitResult[];
  prompt: PromptArtifact;
}
