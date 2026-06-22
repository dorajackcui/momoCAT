import type { TagPolicy } from '@cat/core/tag';
import type { TranslationAuditSink } from './audit/TranslationAudit';
import type { ReasoningEffort } from './ports';

export type LocalizationTargetScope = 'blank-only' | 'overwrite-non-confirmed';

export type LocalizationTargetBaseline = 'use-current-targets' | 'ignore-current-targets';

export type LocalizationMode = 'standard' | 'dialogue';

export type LocalizationRequestMode = 'window' | 'window-partial';

export interface ExternalTranslationUnit {
  id: string;
  source: string;
  target?: string;
  locked?: boolean;
  sourceLanguage?: string;
  targetLanguage?: string;
  context?: string;
  fileName?: string;
  rowNumber?: number;
  metadata?: Record<string, unknown>;
}

export type LocalizationUnit = ExternalTranslationUnit;

export interface MTModuleOptions {
  providerId?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  systemPrompt?: string;
  temperature?: number;
}

export interface TranslateUnitsOptions {
  targetScope?: LocalizationTargetScope;
  targetBaseline?: LocalizationTargetBaseline;
  mode?: LocalizationMode;
  requestMode?: LocalizationRequestMode;
  tagPolicy?: TagPolicy;
  includeReferences?: boolean;
  maxConcurrency?: number;
  batchSize?: number;
  providerOverride?: string;
  mt?: MTModuleOptions;
}

export interface TranslateFileJobOptions {
  jobId?: string;
  checkpointPath?: string;
  eventsPath?: string;
  artifactsPath?: string;
  snapshotPath?: string;
  resumeFingerprint?: string;
  resume?: boolean;
  maxAttempts?: number;
  snapshotEveryUnits?: number;
  snapshotEverySeconds?: number;
  progressStdout?: boolean;
}

export interface LocalizationEngineOptions {
  dbPath?: string;
  maxConcurrency?: number;
  defaultTargetScope?: LocalizationTargetScope;
  defaultMode?: LocalizationMode;
  mt?: MTModuleOptions;
  auditSink?: TranslationAuditSink;
}

export interface EngineTMReference {
  kind: 'tm' | 'concordance';
  rank: number;
  similarity?: number;
  tmName: string;
  sourceText: string;
  targetText: string;
  matchedSourceText?: string;
}

export interface EngineTBReference {
  tbName: string;
  srcTerm: string;
  tgtTerm: string;
  note?: string | null;
}

export interface TranslateUnitReferences {
  tm: EngineTMReference[];
  tb: EngineTBReference[];
}

export interface TranslateUnitSuccess {
  id: string;
  source: string;
  target: string;
  status: 'translated' | 'skipped' | 'reused';
  references?: TranslateUnitReferences;
  metadata?: Record<string, unknown>;
}

export interface TranslateUnitFailure {
  id: string;
  source: string;
  target?: string;
  status: 'failed';
  error: string;
  references?: TranslateUnitReferences;
  metadata?: Record<string, unknown>;
}

export type TranslateUnitResult = TranslateUnitSuccess | TranslateUnitFailure;

export type LocalizationUnitResult = TranslateUnitResult;

export interface RuntimeTMSummary {
  enabled: boolean;
  tagPolicy: TagPolicy;
  seeded: number;
  appended: number;
  skipped: number;
  entryCount: number;
  inspectCalls: number;
  hitUnits: number;
  tmHits: number;
  concordanceHits: number;
  capped: boolean;
}

export interface TranslateUnitsResult {
  summary: {
    total: number;
    translated: number;
    skipped: number;
    failed: number;
    reused?: number;
  };
  results: TranslateUnitResult[];
  runtimeTm?: RuntimeTMSummary;
}

export interface TranslateUnitsInput {
  projectId: number;
  units: ExternalTranslationUnit[];
  options?: TranslateUnitsOptions;
}

export interface TranslateProjectSegmentUnit extends ExternalTranslationUnit {
  id: string;
}

export interface TranslateProjectSegmentsInput {
  projectId: number;
  documentId: string;
  units: TranslateProjectSegmentUnit[];
  options?: TranslateUnitsOptions;
  job?: {
    jobId?: string;
    maxAttempts?: number;
  };
  onResult?: (result: TranslateUnitResult) => Promise<void> | void;
  onProgress?: (data: { current: number; total: number; message?: string }) => void;
}

export interface FileTranslationColumns {
  sourceHeader?: string;
  targetHeader?: string;
  contextHeader?: string;
  sourceCol?: number;
  targetCol?: number;
  contextCol?: number;
  hasHeader?: boolean;
}

export interface TranslateFileOptions {
  projectId: number;
  inputPath: string;
  outputPath: string;
  format?: 'xlsx' | 'csv';
  columns?: FileTranslationColumns;
  options?: TranslateUnitsOptions;
  job?: TranslateFileJobOptions;
}

export type TranslateFileInput = TranslateFileOptions;

export interface TranslateFileResult extends TranslateUnitsResult {
  inputPath: string;
  outputPath: string;
}

export interface LocalizationTMResourceConfig {
  id: string;
  name: string;
  priority: number;
  permission?: string;
  type?: string;
  entryCount?: number;
}

export interface LocalizationTBResourceConfig {
  id: string;
  name: string;
  priority: number;
  entryCount?: number;
}

export interface ProjectLocalizationConfig {
  projectId: number;
  projectName: string;
  sourceLanguage: string;
  targetLanguage: string;
  prompt?: string | null;
  model?: string | null;
}

export interface InspectProjectResult {
  project: ProjectLocalizationConfig;
  resources: {
    translationMemories: LocalizationTMResourceConfig[];
    termBases: LocalizationTBResourceConfig[];
  };
  mt: {
    providerId?: string | null;
    model?: string | null;
    apiKeySet: boolean;
  };
  ready: boolean;
  errors: string[];
}

export interface LocalizationEngineProfile {
  projectId: number;
  projectName: string;
  srcLang: string;
  tgtLang: string;
  promptChars: number;
  model: string | null;
  apiKeySet: boolean;
  mountedTMCount: number;
  mountedTBCount: number;
  ready: boolean;
  errors: string[];
}
