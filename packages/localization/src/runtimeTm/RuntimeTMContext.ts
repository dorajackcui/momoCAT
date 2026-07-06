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

// Default cap on distinct runtime TM entries. The runtime TM lives in an
// in-memory SQLite database with a trigram FTS index, so a very large job
// (e.g. a 150k-row file) must not grow it without bound; past the cap the
// job simply stops gaining new runtime references.
export const DEFAULT_RUNTIME_TM_MAX_ENTRIES = 50_000;

type RuntimeTMAppendCounter = 'appended' | 'seeded';

export class RuntimeTMContext {
  private readonly runtimeDb: RuntimeTMDatabase;
  private readonly tmModule: TMModule;
  private readonly tmService: TMService;
  private readonly srcLang: string;
  private readonly tgtLang: string;
  private readonly tagPolicy: TagPolicy;
  private readonly maxEntries: number;
  private readonly entrySrcHashes = new Set<string>();
  private entryCount = 0;
  private seeded = 0;
  private appended = 0;
  private skipped = 0;
  private inspectCalls = 0;
  private hitUnits = 0;
  private tmHits = 0;
  private concordanceHits = 0;
  private capped = false;
  private failed = false;
  private disposed = false;

  private constructor(options: RuntimeTMContextOptions) {
    this.srcLang = options.srcLang;
    this.tgtLang = options.tgtLang;
    this.tagPolicy = resolveTagPolicy(options.tagPolicy);
    this.maxEntries = options.maxEntries ?? DEFAULT_RUNTIME_TM_MAX_ENTRIES;
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
    return !this.failed && !this.disposed && this.entryCount > 0;
  }

  commitResults(results: readonly UnitResult[]): RuntimeTMCommitSummary {
    return this.appendResults(results, 'appended');
  }

  seedResults(results: readonly UnitResult[]): RuntimeTMCommitSummary {
    return this.appendResults(results, 'seeded');
  }

  async inspect(segment: Segment): Promise<TMArtifact> {
    this.inspectCalls += 1;
    let artifact: TMArtifact;
    try {
      artifact = await this.tmModule.inspect(this.runtimeDb.projectId, segment);
    } catch {
      // The runtime TM is an auxiliary reference cache: a lookup failure must
      // not fail the unit. Fall back to "no runtime matches" for this segment.
      return emptyRuntimeTMArtifact(segment);
    }
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
      enabled: !this.failed,
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
    this.disposed = true;
    try {
      this.runtimeDb.db.close();
    } catch {
      // Closing a broken in-memory database must not fail job teardown.
    }
  }

  private appendResults(
    results: readonly UnitResult[],
    aggregateAppendCounter: RuntimeTMAppendCounter,
  ): RuntimeTMCommitSummary {
    if (this.failed || this.disposed) {
      this.skipped += results.length;
      return { appended: 0, skipped: results.length, disabled: true };
    }

    let appended = 0;
    let skipped = 0;
    let disabled = false;

    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (!isRuntimeTMEligibleResult(result)) {
        skipped += 1;
        this.skipped += 1;
        continue;
      }

      try {
        const segment = createTransientSegment(
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
        );

        // Repeated sources upsert into one entry (last translation wins), so
        // only unseen srcHashes count against entryCount and the cap.
        const isNewEntry = !this.entrySrcHashes.has(segment.srcHash);
        if (isNewEntry && this.entryCount >= this.maxEntries) {
          skipped += 1;
          disabled = true;
          this.skipped += 1;
          this.capped = true;
          continue;
        }

        this.tmService.upsertFromConfirmedSegment(this.runtimeDb.projectId, segment);
        if (isNewEntry) {
          this.entrySrcHashes.add(segment.srcHash);
          this.entryCount += 1;
        }
      } catch {
        // A write failure means the runtime TM can no longer be trusted.
        // Disable it for the rest of the job instead of failing the job:
        // translations are already checkpointed by the time commits run.
        this.failed = true;
        const remaining = results.length - index;
        skipped += remaining;
        this.skipped += remaining;
        return { appended, skipped, disabled: true };
      }
      appended += 1;
      this[aggregateAppendCounter] += 1;
    }

    return { appended, skipped, disabled };
  }
}

function emptyRuntimeTMArtifact(segment: Segment): TMArtifact {
  const meta = segment.meta as Segment['meta'] & { externalUnitId?: unknown };
  return {
    unitId: String(meta.externalUnitId ?? segment.segmentId),
    segmentId: segment.segmentId,
    mountedTMs: [],
    rawMatches: [],
    selectedReferences: {
      tmReferences: [],
      concordanceReferences: [],
    },
    selectionPolicy: {
      maxTmReferences: 0,
      maxConcordanceReferences: 0,
    },
    diagnostics: [],
  };
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
