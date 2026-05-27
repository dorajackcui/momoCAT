import { mapTMEngineReferences } from '../modules/TMModule';
import {
  resolveRequestModeReferences,
  type RequestModeReferenceResolver,
} from '../requestModes/shared/references';
import type { RuntimeTMContext } from './RuntimeTMContext';
import { mergeRuntimeTMArtifact } from './RuntimeTMSelection';

export class RuntimeTMReferenceResolver {
  public readonly resolve: RequestModeReferenceResolver;

  constructor(
    private readonly runtimeTm: Pick<RuntimeTMContext, 'hasEntries' | 'inspect'>,
    private readonly persistentResolver: RequestModeReferenceResolver = resolveRequestModeReferences,
  ) {
    this.resolve = async (params) => {
      const persistentReferences = await this.persistentResolver(params);

      if (!this.runtimeTm.hasEntries()) {
        return persistentReferences;
      }

      const runtimeTm = await this.runtimeTm.inspect(params.segment);
      const mergedTm = mergeRuntimeTMArtifact({
        persistent: persistentReferences.tm,
        runtime: runtimeTm,
      });

      return {
        ...persistentReferences,
        engineReferences: {
          tm: mapTMEngineReferences(mergedTm.rawMatches),
          tb: persistentReferences.engineReferences.tb,
        },
        tm: mergedTm,
      };
    };
  }
}
