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
import type { RuntimeTMSummary } from '../types';
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

type RuntimeTMAppendCounter = 'appended' | 'seeded';

export class RuntimeTMContext {
  private readonly runtimeDb: RuntimeTMDatabase;
  private readonly tmModule: TMModule;
  private readonly tmService: TMService;
  private readonly srcLang: string;
  private readonly tgtLang: string;
  private readonly tagPolicy: TagPolicy;
  private readonly maxEntries: number;
  private entryCount = 0;
  private seeded = 0;
  private appended = 0;
  private skipped = 0;
  private inspectCalls = 0;
  private hitUnits = 0;
  private tmHits = 0;
  private concordanceHits = 0;
  private capped = false;
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
    return this.appendResults(results, 'appended');
  }

  seedResults(results: readonly UnitResult[]): RuntimeTMCommitSummary {
    return this.appendResults(results, 'seeded');
  }

  async inspect(segment: Segment): Promise<TMArtifact> {
    this.assertOpen();
    const artifact = await this.tmModule.inspect(this.runtimeDb.projectId, segment);
    this.inspectCalls += 1;
    if (artifact.rawMatches.length > 0) {
      this.hitUnits += 1;
    }
    for (const match of artifact.rawMatches) {
      if (match.kind === 'tm') {
        this.tmHits += 1;
      } else if (match.kind === 'concordance') {
        this.concordanceHits += 1;
      }
    }
    return artifact;
  }

  summary(): RuntimeTMSummary {
    return {
      enabled: true,
      tagPolicy: this.tagPolicy,
      seeded: this.seeded,
      appended: this.appended,
      skipped: this.skipped,
      entryCount: this.entryCount,
      inspectCalls: this.inspectCalls,
      hitUnits: this.hitUnits,
      tmHits: this.tmHits,
      concordanceHits: this.concordanceHits,
      capped: this.capped,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.runtimeDb.db.close();
    this.disposed = true;
  }

  private appendResults(
    results: readonly UnitResult[],
    aggregateAppendCounter: RuntimeTMAppendCounter,
  ): RuntimeTMCommitSummary {
    this.assertOpen();

    let appended = 0;
    let skipped = 0;
    let disabled = false;

    for (const result of results) {
      if (!isRuntimeTMEligibleResult(result)) {
        skipped += 1;
        this.skipped += 1;
        continue;
      }

      if (this.entryCount >= this.maxEntries) {
        skipped += 1;
        disabled = true;
        this.skipped += 1;
        this.capped = true;
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
      this[aggregateAppendCounter] += 1;
    }

    return { appended, skipped, disabled };
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
