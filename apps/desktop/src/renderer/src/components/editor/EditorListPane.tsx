import React, { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { SearchableEditorSegment } from '../editorFilterUtils';
import { EditorRow } from '../EditorRow';
import type { EditorMatchMode } from '../editorFilterUtils';
import type { EditorSegmentStore } from '../../hooks/editor/editorSegmentStore';
import type { TargetEditorController } from '../editor-row/useEditorRowDraftController';
import {
  ESTIMATED_EDITOR_ROW_HEIGHT,
  getEditorVirtualizerInitialRect,
} from './editorVirtualizationFlag';

interface EditorListPaneProps {
  scrollParentRef: React.RefObject<HTMLDivElement | null>;
  virtualized: boolean;
  filteredSegments: SearchableEditorSegment[];
  segmentStore: EditorSegmentStore;
  activeFilteredIndex: number;
  activeSegmentId: string | null;
  manualActivationSegmentId: string | null;
  suppressAutoFocusSegmentId: string | null;
  isSearchInputFocused: boolean;
  onRowActivate: (segmentId: string, options?: { autoFocusTarget?: boolean }) => void;
  onRowAutoFocus: (segmentId: string) => void;
  onTranslationChange: (segmentId: string, value: string) => void;
  onTranslationBlur: (segmentId: string) => Promise<void>;
  onSegmentEditStateChange: (segmentId: string, editing: boolean) => void;
  onTargetEditorControllerChange: (
    segmentId: string,
    controller: TargetEditorController | null,
  ) => void;
  onAITranslate: (segmentId: string) => void;
  onAIRefine: (segmentId: string, instruction: string) => void;
  onConfirm: (segmentId: string) => void;
  aiTranslatingSegmentIds: Record<string, boolean>;
  segmentSaveErrors: Record<string, string>;
  sourceHighlightQuery: string;
  targetHighlightQuery: string;
  highlightMode: EditorMatchMode;
  showNonPrintingSymbols: boolean;
}

type StoreBackedEditorRowProps = Omit<
  React.ComponentProps<typeof EditorRow>,
  'segment' | 'rowNumber'
> & {
  segmentId: string;
  originalIndex: number;
  segmentStore: EditorSegmentStore;
};

const StoreBackedEditorRow = React.memo(function StoreBackedEditorRow({
  segmentId,
  originalIndex,
  segmentStore,
  ...rowProps
}: StoreBackedEditorRowProps) {
  const subscribe = useCallback(
    (listener: () => void) => segmentStore.subscribeSegment(segmentId, listener),
    [segmentId, segmentStore],
  );
  const getSnapshot = useCallback(
    () => segmentStore.getSegment(segmentId),
    [segmentId, segmentStore],
  );
  const segment = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!segment) return null;

  return (
    <EditorRow
      {...rowProps}
      segment={segment}
      rowNumber={segment.meta?.rowRef || originalIndex + 1}
    />
  );
});

const EditorListPaneComponent: React.FC<EditorListPaneProps> = ({
  scrollParentRef,
  virtualized,
  filteredSegments,
  segmentStore,
  activeFilteredIndex,
  activeSegmentId,
  manualActivationSegmentId,
  suppressAutoFocusSegmentId,
  isSearchInputFocused,
  onRowActivate,
  onRowAutoFocus,
  onTranslationChange,
  onTranslationBlur,
  onSegmentEditStateChange,
  onTargetEditorControllerChange,
  onAITranslate,
  onAIRefine,
  onConfirm,
  aiTranslatingSegmentIds,
  segmentSaveErrors,
  sourceHighlightQuery,
  targetHighlightQuery,
  highlightMode,
  showNonPrintingSymbols,
}) => {
  const initialVirtualizerRect = useMemo(
    () =>
      getEditorVirtualizerInitialRect(
        typeof window === 'undefined' ? undefined : window.innerHeight,
      ),
    [],
  );
  const renderRow = useCallback(
    (item: SearchableEditorSegment) => (
      <StoreBackedEditorRow
        key={item.segment.segmentId}
        segmentId={item.segment.segmentId}
        originalIndex={item.originalIndex}
        segmentStore={segmentStore}
        repeatedSourceRole={item.repeatedSourceRole}
        isActive={item.segment.segmentId === activeSegmentId}
        disableAutoFocus={
          (isSearchInputFocused && manualActivationSegmentId !== item.segment.segmentId) ||
          suppressAutoFocusSegmentId === item.segment.segmentId
        }
        onActivate={onRowActivate}
        onAutoFocus={onRowAutoFocus}
        onChange={onTranslationChange}
        onBlur={onTranslationBlur}
        onEditStateChange={onSegmentEditStateChange}
        onTargetEditorControllerChange={onTargetEditorControllerChange}
        onAITranslate={onAITranslate}
        onAIRefine={onAIRefine}
        onConfirm={onConfirm}
        isAITranslating={Boolean(aiTranslatingSegmentIds[item.segment.segmentId])}
        isAIRefining={Boolean(aiTranslatingSegmentIds[item.segment.segmentId])}
        saveError={segmentSaveErrors[item.segment.segmentId]}
        sourceHighlightQuery={sourceHighlightQuery}
        targetHighlightQuery={targetHighlightQuery}
        highlightMode={highlightMode}
        showNonPrintingSymbols={showNonPrintingSymbols}
      />
    ),
    [
      activeSegmentId,
      aiTranslatingSegmentIds,
      highlightMode,
      isSearchInputFocused,
      manualActivationSegmentId,
      onAIRefine,
      onAITranslate,
      onConfirm,
      onRowActivate,
      onRowAutoFocus,
      onSegmentEditStateChange,
      onTargetEditorControllerChange,
      onTranslationBlur,
      onTranslationChange,
      segmentSaveErrors,
      segmentStore,
      showNonPrintingSymbols,
      sourceHighlightQuery,
      suppressAutoFocusSegmentId,
      targetHighlightQuery,
    ],
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: filteredSegments.length,
    estimateSize: () => ESTIMATED_EDITOR_ROW_HEIGHT,
    getScrollElement: () => scrollParentRef.current,
    getItemKey: (index) => filteredSegments[index]?.segment.segmentId ?? index,
    initialRect: initialVirtualizerRect,
    overscan: 8,
  });

  const lastScrolledTargetRef = useRef<{ segmentId: string; index: number } | null>(null);

  useEffect(() => {
    if (!virtualized || !activeSegmentId) return;
    const activeIndex = activeFilteredIndex;
    if (activeIndex < 0) return;
    // Segment edits replace array items without moving the active row; only
    // scroll when the activation target or its list position actually changed.
    const lastScrolled = lastScrolledTargetRef.current;
    if (
      lastScrolled &&
      lastScrolled.segmentId === activeSegmentId &&
      lastScrolled.index === activeIndex
    ) {
      return;
    }
    lastScrolledTargetRef.current = { segmentId: activeSegmentId, index: activeIndex };
    virtualizer.scrollToIndex(activeIndex, { align: 'auto' });
  }, [activeFilteredIndex, activeSegmentId, virtualized, virtualizer]);

  return (
    <>
      {virtualized && filteredSegments.length > 0 ? (
        <div
          className="relative w-full"
          style={{
            height: `${virtualizer.getTotalSize()}px`,
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const item = filteredSegments[virtualItem.index];
            if (!item) return null;
            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                {renderRow(item)}
              </div>
            );
          })}
        </div>
      ) : (
        filteredSegments.map((item) => renderRow(item))
      )}

      {filteredSegments.length === 0 && (
        <div className="px-8 py-10 text-center text-sm text-text-faint">
          No segments match current filters.
        </div>
      )}

      <div className="h-4" />
    </>
  );
};

export const EditorListPane = React.memo(EditorListPaneComponent);
