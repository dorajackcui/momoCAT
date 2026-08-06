import type { TranslationAuditSink } from '@cat/localization';
import type { SegmentService } from './SegmentService';
import type { TBService } from './TBService';
import type { TMService } from './TMService';
import type { AIModule } from './modules/AIModule';
import type { ProjectFileModule } from './modules/ProjectFileModule';
import type {
  InspectFileRunner,
  ReferenceExportRunner,
  SourceTerminologyPrecheckRunner,
} from './modules/ProjectReferenceFileOperations';
import type { TBModule } from './modules/TBModule';
import type { TMModule } from './modules/TMModule';
import type { AIRuntimeConfigProvider, AITransport, SpreadsheetGateway } from './ports';

export interface ProjectServiceDependencies {
  filter?: SpreadsheetGateway;
  tmService?: TMService;
  tbService?: TBService;
  segmentService?: SegmentService;
  aiTransport?: AITransport;
  aiRuntimeConfigProvider?: AIRuntimeConfigProvider;
  inspectFileRunner?: InspectFileRunner;
  referenceExportRunner?: ReferenceExportRunner;
  sourceTerminologyPrecheckRunner?: SourceTerminologyPrecheckRunner;
  translationAuditSink?: TranslationAuditSink;
  projectModule?: ProjectFileModule;
  tmModule?: TMModule;
  tbModule?: TBModule;
  aiModule?: AIModule;
}
