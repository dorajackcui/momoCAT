import type { Segment, TBMatch } from '@cat/core/models';
import type { TMConcordanceEntry, TMMatch } from '../../../shared/ipc';

export type ReferenceLookupRequestKind = 'tm' | 'tb' | 'concordance';

export type ReferenceLookupWorkerRequest =
  | { requestId: number; kind: 'tm'; projectId: number; segment: Segment }
  | { requestId: number; kind: 'tb'; projectId: number; segment: Segment }
  | { requestId: number; kind: 'concordance'; projectId: number; query: string };

export type ReferenceLookupWorkerResponse =
  | {
      requestId: number;
      ok: true;
      kind: 'tm';
      result: TMMatch[];
    }
  | {
      requestId: number;
      ok: true;
      kind: 'tb';
      result: TBMatch[];
    }
  | {
      requestId: number;
      ok: true;
      kind: 'concordance';
      result: TMConcordanceEntry[];
    }
  | {
      requestId: number;
      ok: false;
      kind: ReferenceLookupRequestKind;
      error: string;
    };

export interface ReferenceLookupService {
  warmUp(): Promise<void>;
  findTmMatches(projectId: number, segment: Segment): Promise<TMMatch[]>;
  findTbMatches(projectId: number, segment: Segment): Promise<TBMatch[]>;
  searchConcordance(projectId: number, query: string): Promise<TMConcordanceEntry[]>;
}
