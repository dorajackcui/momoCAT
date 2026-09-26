export { runBounded } from './RequestScheduler';
export { runQA, type RunQAInput } from './qa/runQA';
export { runProjectFileQA } from './qa/runProjectFileQA';
export { runQAFileCommand, QA_CHECK_NAMES, type QAFileCommandConfig } from './cli/qaFileCommand';
export type { RunBoundedOptions, ScheduledResult } from './RequestScheduler';
export { LocalizationEngine } from './LocalizationEngine';
export type { LocalizationEngineConstructorOptions } from './LocalizationEngine';
export { LocalizationInspector } from './LocalizationInspector';
export type {
  InspectFileInput,
  InspectFileResult,
  LocalizationInspectorOptions,
} from './LocalizationInspector';
export { LocalizationReferenceExporter } from './LocalizationReferenceExporter';
export type {
  ExportReferencesForMtInput,
  ExportReferencesForMtResult,
  LocalizationReferenceExporterOptions,
  ReferenceExportUnitResult,
} from './LocalizationReferenceExporter';
export { LocalizationSourceTerminologyPrechecker } from './LocalizationSourceTerminologyPrechecker';
export type {
  LocalizationSourceTerminologyPrecheckerOptions,
  SourceTerminologyPrecheckFileInput,
  SourceTerminologyPrecheckFileResult,
  SourceTerminologyPrecheckFileUnitResult,
} from './LocalizationSourceTerminologyPrechecker';
export { SourceTerminologyExtractor } from './SourceTerminologyExtractor';
export type {
  SourceTerminologyAggregate,
  SourceTerminologyExtractionInput,
  SourceTerminologyExtractionResult,
  SourceTerminologyExtractorDependencies,
  SourceTerminologyHistoricalTerm,
  SourceTerminologyUnit,
  SourceTerminologyUnitResult,
} from './SourceTerminologyExtractor';
export {
  DEFAULT_SOURCE_TERMINOLOGY_PROMPT_ID,
  SOURCE_TERMINOLOGY_PROMPT_NAME_MAX_CHARS,
  SOURCE_TERMINOLOGY_SELECTION_PROMPT_MAX_CHARS,
  SourceTerminologyPromptSettingsService,
} from './SourceTerminologyPromptSettingsService';
export type {
  SourceTerminologyPromptPreset,
  SourceTerminologyPromptSettingsMutation,
  SourceTerminologyPromptSettingsSnapshot,
} from './SourceTerminologyPromptSettingsService';
export type * from './artifacts';
export type * from './types';
export type * from './job/types';
export { ArtifactStore } from './job/ArtifactStore';
export { CheckpointIndex, CheckpointStore } from './job/CheckpointStore';
export type { CheckpointDiagnostic, CheckpointLoadResult } from './job/CheckpointStore';
export { EventSink } from './job/EventSink';
export type { EventSinkOptions, StdoutWriter } from './job/EventSink';
export {
  JsonlTranslationAuditSink,
  createMemoryTranslationAuditSink,
  noopTranslationAuditSink,
  summarizeAuditText,
} from './audit/TranslationAudit';
export type {
  TranslationAuditContext,
  TranslationAuditEvent,
  TranslationAuditSink,
  TranslationAuditUnitRef,
} from './audit/TranslationAudit';
export { computeSourceHash } from './job/sourceHash';
export type { SourceHashInput } from './job/sourceHash';
export { createLocalizationTaskExecutor } from './job/LocalizationTaskExecutor';
export { TranslationJobRunner } from './job/TranslationJobRunner';
export type {
  TranslationJobRunnerCallbackContext,
  TranslationJobRunResult,
  TranslationJobRunnerDependencies,
  TranslationJobSummary,
} from './job/TranslationJobRunner';
export {
  OneUnitTaskPlanner,
  WindowPartialTaskPlanner,
  WindowModeTaskPlanner,
  normalizeWindowModeBatchSize,
} from './job/TaskPlanner';
export type { TaskPlanner, WindowModeTaskPlannerOptions } from './job/TaskPlanner';
export { createTransientSegment, toTransientSegmentId } from './transientSegment';
export type {
  TransientSegment,
  TransientSegmentContext,
  TransientSegmentOptions,
} from './transientSegment';
export {
  fileRowsToLocalizationUnits,
  parseExternalSpreadsheet,
  writeReferencesForMtSpreadsheet,
  writeInspectSpreadsheet,
  writeTranslatedSpreadsheet,
} from './modules/FileModule';
export type {
  ParsedSpreadsheetFile,
  ReferenceExportSpreadsheetRow,
  SheetCell,
} from './modules/FileModule';
export { writeSourceTerminologyPrecheckSpreadsheet } from './modules/sourceTerminologyPrecheckSpreadsheet';
export type {
  SourceTerminologyPrecheckSpreadsheetRow,
  SourceTerminologySummarySpreadsheetRow,
} from './modules/sourceTerminologyPrecheckSpreadsheet';
export {
  inferFileTranslationJobSidecarPaths,
  prepareFileTranslationJob,
  resolveFileTranslationJobSidecarPaths,
  translateSpreadsheetFileJob,
} from './fileTranslationJobAdapter';
export type {
  FileTranslationJobRunnerFactory,
  FileTranslationJobSidecarPaths,
  PreparedFileTranslationJob,
  TranslateSpreadsheetFileJobOptions,
} from './fileTranslationJobAdapter';
export {
  prepareProjectSegmentTranslationJob,
  translateProjectSegmentsJob,
} from './projectSegmentJobAdapter';
export type {
  PreparedProjectSegmentTranslationJob,
  ProjectSegmentTranslationJobRunnerFactory,
  ProjectSegmentTranslationUnit,
  TranslateProjectSegmentsJobInput,
  TranslateProjectSegmentsJobOptions,
} from './projectSegmentJobAdapter';
export { normalizeTargetForBaseline, resolveTargetBaseline } from './targetBaseline';
export type { TargetBaselineOptions } from './targetBaseline';
export type * from './ports';
export { SqliteProjectRepository } from './adapters/sqlite/SqliteProjectRepository';
export { SqliteSettingsRepository } from './adapters/sqlite/SqliteSettingsRepository';
export { SqliteTBRepository } from './adapters/sqlite/SqliteTBRepository';
export { SqliteTMRepository } from './adapters/sqlite/SqliteTMRepository';
export { TMService } from './services/TMService';
export type {
  TMMatch,
  TMMatchBase,
  TMMatchKind,
  StandardTMMatch,
  ConcordanceTMMatch,
} from './services/TMService';
export { TBService } from './services/TBService';
export {
  AIProviderCatalogService,
  filterDiscoveredModelIds,
  type AddAIProviderInput,
  type AIConnectionSummary,
  type AIProviderSummary,
  type AITestConnectionResult,
  type ResolvedAIProviderConfig,
  type TestAIConnectionInput,
} from './providers/AIProviderCatalogService';
export {
  AIRuntimeConfigService,
  DefaultAIRuntimeConfigProvider,
  createDefaultAIRuntimeConfig,
  sanitizeAIRuntimeConfig,
  type AiRuntimeConfig,
} from './providers/AIRuntimeConfigService';
export { AIProviderTransport } from './providers/AIProviderTransport';
export {
  DEFAULT_TM_PROMPT_REFERENCE_LIMITS,
  MAX_CONCORDANCE_PROMPT_REFERENCES,
  MAX_ENGINE_TM_REFERENCES,
  MAX_TM_PROMPT_REFERENCES,
  TMModule,
  buildTMPromptReferences,
  mapTMEngineReferences,
} from './modules/TMModule';
export {
  MAX_ENGINE_TB_REFERENCES,
  MAX_TB_PROMPT_REFERENCES,
  TBModule,
  buildTBPromptReferences,
  mapTBEngineReferences,
} from './modules/TBModule';
export { MTModule } from './modules/MTModule';
export type {
  ComposeBatchPromptInput,
  MTBatchCurrentUnitInput,
  MTBatchTranslateResult,
  MTBatchUnitResult,
  MTModuleDependencies,
  PreparedBatchPromptInput,
  PromptMTConfig,
  ResolvedMTConfig,
  TranslatePreparedBatchPromptInput,
} from './modules/MTModule';
export { runTranslateFileCommand } from './cli/translateFileCommand';
export type { TranslateFileCommandConfig } from './cli/translateFileCommand';
export { runExportReferencesForMtCommand } from './cli/exportReferencesForMtCommand';
export type { ExportReferencesForMtCommandConfig } from './cli/exportReferencesForMtCommand';
export { runInspectLocalizationCommand } from './cli/inspectLocalizationCommand';
export type { InspectLocalizationCommandConfig } from './cli/inspectLocalizationCommand';
export { runInspectProjectsCommand } from './cli/inspectProjectsCommand';
export type {
  InspectMountedTBSummary,
  InspectMountedTMSummary,
  InspectProjectFileSummary,
  InspectProjectSummary,
  InspectProjectsCommandConfig,
  InspectProjectsResult,
  InspectProviderSummary,
} from './cli/inspectProjectsCommand';
export { runProjectSegmentQA } from './qa/runProjectSegmentQA';

export { AITextTranslator } from './modules/AITextTranslator';
export type { TranslateDebugMeta, TranslateSegmentParams } from './modules/AITextTranslator';
export {
  AI_PROMPT_DEBUG_ENV,
  AI_PROMPT_DEBUG_FILE_ENV,
  isAIPromptDebugEnabled,
} from './modules/promptDebug';
export { translateProjectSegment, testProjectText } from './modules/segmentTranslation';
export type { SegmentTranslationDependencies } from './modules/segmentTranslation';
export { resolveTranslationPromptReferences } from './modules/promptReferences';
export type {
  PromptReferenceResolvers,
  TranslationPromptReferences,
} from './modules/promptReferences';
