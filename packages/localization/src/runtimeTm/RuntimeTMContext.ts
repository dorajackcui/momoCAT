import type { Segment } from '@cat/core/models';
import type { TagPolicy } from '@cat/core/tag';
import { SqliteProjectRepository } from '../adapters/sqlite/SqliteProjectRepository';
import { SqliteTMRepository } from '../adapters/sqlite/SqliteTMRepository';
import type { TMArtifact } from '../artifacts';
import type { UnitResult } from '../job/types';
import { TMModule } from '../modules/TMModule';
import { TMService } from '../services/TMService';
import { resolveTagPolicy } from '../tagPolicy';
import { createTransientSegment } from '../transientSegment';
import { createRuntimeTMDatabase, type RuntimeTMDatabase } from './RuntimeTMDatabase';

export interface RuntimeTMContextOptions {
  srcLang: string;
  tgtLang: string;
  tagPolicy?: TagPolicy;
  maxEntries?: number;
}

export interface RuntimeTMCommitSummary {
  appended: number;
  skipped: number;
  disabled: boolean;
}

export class RuntimeTMContext {
  private readonly runtimeDb: RuntimeTMDatabase;
  private readonly tmModule: TMModule;
  private readonly tmService: TMService;
  private readonly srcLang: string;
  private readonly tgtLang: string;
  private readonly tagPolicy: TagPolicy;
  private readonly maxEntries: number;
  private entryCount = 0;
  private disposed = false;

  private constructor(options: RuntimeTMContextOptions) {
    this.srcLang = options.srcLang;
    this.tgtLang = options.tgtLang;
    this.tagPolicy = resolveTagPolicy(options.tagPolicy);
    this.maxEntries = options.maxEntries ?? Number.POSITIVE_INFINITY;
    this.runtimeDb = createRuntimeTMDatabase({
      srcLang: options.srcLang,
      tgtLang: options.tgtLang,
    });

    const projectRepo = new SqliteProjectRepository(this.runtimeDb.db);
    const tmRepo = new SqliteTMRepository(this.runtimeDb.db);
    this.tmService = new TMService(projectRepo, tmRepo);
    this.tmModule = new TMModule(tmRepo, this.tmService);
  }

  static create(options: RuntimeTMContextOptions): RuntimeTMContext {
    return new RuntimeTMContext(options);
  }

  hasEntries(): boolean {
    return this.entryCount > 0;
  }

  commitResults(results: readonly UnitResult[]): RuntimeTMCommitSummary {
    this.assertOpen();

    let appended = 0;
    let skipped = 0;
    let disabled = false;

    for (const result of results) {
      if (!isRuntimeTMEligibleResult(result)) {
        skipped += 1;
        continue;
      }

      if (this.entryCount >= this.maxEntries) {
        skipped += 1;
        disabled = true;
        continue;
      }

      this.tmService.upsertFromConfirmedSegment(
        this.runtimeDb.projectId,
        createTransientSegment(
          {
            id: result.unitId,
            source: result.source,
            target: result.target,
            sourceLanguage: this.srcLang,
            targetLanguage: this.tgtLang,
            metadata: result.metadata,
          },
          this.entryCount,
          {
            projectId: this.runtimeDb.projectId,
            sourceLanguage: this.srcLang,
            targetLanguage: this.tgtLang,
          },
          { tagPolicy: this.tagPolicy },
        ),
      );
      this.entryCount += 1;
      appended += 1;
    }

    return { appended, skipped, disabled };
  }

  seedResults(results: readonly UnitResult[]): RuntimeTMCommitSummary {
    return this.commitResults(results);
  }

  inspect(segment: Segment): Promise<TMArtifact> {
    this.assertOpen();
    return this.tmModule.inspect(this.runtimeDb.projectId, segment);
  }

  dispose(): void {
    if (this.disposed) return;
    this.runtimeDb.db.close();
    this.disposed = true;
  }

  private assertOpen(): void {
    if (this.disposed) {
      throw new Error('Runtime TM context has been disposed');
    }
  }
}

function isRuntimeTMEligibleResult(
  result: UnitResult,
): result is UnitResult & { target: string } {
  return (
    (result.status === 'translated' || result.status === 'skipped') &&
    result.source.trim().length > 0 &&
    typeof result.target === 'string' &&
    result.target.trim().length > 0
  );
}
