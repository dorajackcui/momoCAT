import type { Segment } from '@cat/core/models';
import type { JobUnit, UnitResult } from '../job/types';
import type { MTModule } from '../modules/MTModule';
import type { TBModule } from '../modules/TBModule';
import type { TMModule } from '../modules/TMModule';
import type { TranslateUnitReferences } from '../types';

export interface ResolvedReferences {
  engineReferences: TranslateUnitReferences;
  tm: Awaited<ReturnType<TMModule['inspect']>>;
  tb: Awaited<ReturnType<TBModule['inspect']>>;
}

export interface PreparedTranslationArtifacts {
  tm: ResolvedReferences['tm'];
  tb: ResolvedReferences['tb'];
  prompt: Awaited<ReturnType<MTModule['translate']>>['prompt'];
}

export interface PreparedWindowBatchResult {
  results: UnitResult[];
  artifacts?: import('../job/types').ArtifactRecord[];
}

export interface PreparedTranslatableJobUnit {
  jobUnit: JobUnit;
  segment: Segment;
}

export interface RequestModeReferenceModules {
  tmModule: Pick<TMModule, 'inspect'>;
  tbModule: Pick<TBModule, 'inspect'>;
}
