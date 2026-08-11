import { TagValidator } from '@cat/core/qa';
import type { CATDatabase } from '@cat/db';
import { SqliteProjectRepository } from '../adapters/sqlite/SqliteProjectRepository';
import { SqliteSettingsRepository } from '../adapters/sqlite/SqliteSettingsRepository';
import { SqliteTBRepository } from '../adapters/sqlite/SqliteTBRepository';
import { SqliteTMRepository } from '../adapters/sqlite/SqliteTMRepository';
import { MTModule } from '../modules/MTModule';
import { TBModule } from '../modules/TBModule';
import { TMModule } from '../modules/TMModule';
import { AIProviderTransport } from '../providers/AIProviderTransport';
import { DefaultAIRuntimeConfigProvider } from '../providers/AIRuntimeConfigService';
import { AIProviderCatalogService } from '../providers/AIProviderCatalogService';
import { LegacySingleUnitConcurrentStrategy } from '../requestModes/legacySingleUnitConcurrent/LegacySingleUnitConcurrentStrategy';
import { WindowPartialSequentialBatchStrategy } from '../requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy';
import { WindowModeSequentialBatchStrategy } from '../requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy';
import { TBService } from '../services/TBService';
import { TMService } from '../services/TMService';
import type { LocalizationEngineConstructorOptions } from '../types';

export interface LocalizationEngineAssembly {
  projectRepo: SqliteProjectRepository;
  tmRepo: SqliteTMRepository;
  tbRepo: SqliteTBRepository;
  providerCatalogService: AIProviderCatalogService;
  mtModule: MTModule;
  windowModeStrategy: WindowModeSequentialBatchStrategy;
  windowPartialStrategy: WindowPartialSequentialBatchStrategy;
  legacyStrategy: LegacySingleUnitConcurrentStrategy;
}

export function createLocalizationEngineAssembly(
  db: CATDatabase,
  options: LocalizationEngineConstructorOptions,
): LocalizationEngineAssembly {
  const projectRepo = new SqliteProjectRepository(db);
  const settingsRepo = new SqliteSettingsRepository(db);
  const tmRepo = new SqliteTMRepository(db);
  const tbRepo = new SqliteTBRepository(db);
  const tmModule = new TMModule({
    tmRepo,
    tmService: new TMService(projectRepo, tmRepo),
  });
  const tbModule = new TBModule({
    tbRepo,
    tbService: new TBService(projectRepo, tbRepo),
  });
  const aiTransport = options.aiTransport ?? new AIProviderTransport();
  const providerCatalogService = new AIProviderCatalogService(settingsRepo, aiTransport);
  const mtModule = new MTModule({
    providerCatalogService,
    aiRuntimeConfigProvider:
      options.aiRuntimeConfigProvider ?? new DefaultAIRuntimeConfigProvider(),
    aiTransport,
    tagValidator: new TagValidator(),
  });
  const strategyModules = { tmModule, tbModule, mtModule };

  return {
    projectRepo,
    tmRepo,
    tbRepo,
    providerCatalogService,
    mtModule,
    windowModeStrategy: new WindowModeSequentialBatchStrategy(strategyModules),
    windowPartialStrategy: new WindowPartialSequentialBatchStrategy(strategyModules),
    legacyStrategy: new LegacySingleUnitConcurrentStrategy(strategyModules),
  };
}
