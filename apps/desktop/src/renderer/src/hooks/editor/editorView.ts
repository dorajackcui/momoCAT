import type {
  EditorFilterCriteria,
  RepeatedSourceRole,
  SearchableEditorSegment,
} from '../../components/editorFilterUtils';
import {
  filterSearchableSegments,
  sortSearchableSegments,
} from '../../components/editorFilterUtils';
import type { EditorSegmentStore } from './editorSegmentStore';
import { buildSearchableEditorSegmentsWithWeakCache } from './editorSearchableSegments';
import type { Segment } from '@cat/core/models';

/** Row topology is independent from live content, which rows read from the store. */
export interface EditorViewRow {
  segmentId: string;
  originalIndex: number;
  repeatedSourceRole?: RepeatedSourceRole;
}
export interface EditorView {
  rows: EditorViewRow[];
  ids: string[];
  indexById: ReadonlyMap<string, number>;
}
interface Inputs {
  store: EditorSegmentStore;
  criteria: EditorFilterCriteria;
  qaIds?: readonly string[];
  saveErrors: Record<string, string>;
}

/** Snapshot membership/order changes only on criteria, QA scope or document replacement. */
export function createEditorView() {
  const cache = new WeakMap<Segment, SearchableEditorSegment>();
  let previousOrder: readonly string[] | undefined;
  let previousScope: readonly string[] | undefined;
  let previousCriteria = '';
  let view: EditorView | undefined;
  const search = ({ store, criteria, qaIds, saveErrors }: Inputs) => {
    let searchable = buildSearchableEditorSegmentsWithWeakCache({
      segments: store.getSegments(),
      segmentSaveErrors: saveErrors,
      cache,
    });
    if (qaIds) {
      const byId = new Map(searchable.map((item) => [item.segment.segmentId, item]));
      searchable = qaIds.flatMap((id) => {
        const row = byId.get(id);
        return row ? [row] : [];
      });
    }
    return filterSearchableSegments(searchable, criteria);
  };
  return {
    searchIds: (inputs: Inputs) => search(inputs).map((item) => item.segment.segmentId),
    resolve: (inputs: Inputs): EditorView => {
      const order = inputs.store.getOrderIds();
      const criteria = JSON.stringify(inputs.criteria);
      if (
        view &&
        order === previousOrder &&
        inputs.qaIds === previousScope &&
        criteria === previousCriteria
      )
        return view;
      const matches = sortSearchableSegments(
        search(inputs),
        inputs.criteria.sortBy,
        inputs.criteria.sortDirection,
      );
      const rows = matches.map((item) => ({
        segmentId: item.segment.segmentId,
        originalIndex: item.originalIndex,
        repeatedSourceRole: item.repeatedSourceRole,
      }));
      const ids = rows.map((row) => row.segmentId);
      view = { rows, ids, indexById: new Map(ids.map((id, index) => [id, index])) };
      previousOrder = order;
      previousScope = inputs.qaIds;
      previousCriteria = criteria;
      return view;
    },
  };
}
