import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, ProjectFile } from '@cat/core/project';
import { ProjectAITranslateModal } from './project-detail/ProjectAITranslateModal';
import { useEditor } from '../hooks/useEditor';
import { useEditorFilters } from '../hooks/useEditorFilters';
import { apiClient } from '../services/apiClient';
import { EditorHeader } from './editor/EditorHeader';
import { EditorFilterBar } from './editor/EditorFilterBar';
import { EditorListPane } from './editor/EditorListPane';
import { EditorSidebar } from './editor/EditorSidebar';
import { isVirtualizedEditorListEnabled } from './editor/editorVirtualizationFlag';
import { useEditorLayout } from '../hooks/editor/useEditorLayout';
import { useConcordanceShortcut } from '../hooks/editor/useConcordanceShortcut';
import { useEditorBatchActions } from '../hooks/editor/useEditorBatchActions';

interface EditorProps {
  fileId: number;
  onBack: () => void;
}

export const Editor: React.FC<EditorProps> = ({ fileId, onBack }) => {
  const [file, setFile] = useState<ProjectFile | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [isSearchInputFocused, setIsSearchInputFocused] = useState(false);
  const [manualActivationSegmentId, setManualActivationSegmentId] = useState<string | null>(null);
  const [suppressAutoFocusSegmentId, setSuppressAutoFocusSegmentId] = useState<string | null>(null);
  const [showNonPrintingSymbols, setShowNonPrintingSymbols] = useState(false);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const sourceSearchInputRef = useRef<HTMLInputElement>(null);
  const targetSearchInputRef = useRef<HTMLInputElement>(null);
  const isVirtualizedListEnabled = useMemo(
    () => isVirtualizedEditorListEnabled(window.localStorage),
    [],
  );

  const {
    segments,
    activeSegmentId,
    activeMatches,
    activeTerms,
    segmentSaveErrors,
    aiTranslatingSegmentIds,
    loading,
    setActiveSegmentId,
    handleTranslationChange,
    handleSegmentEditStateChange,
    flushSegmentDraft,
    translateSegmentWithAI,
    refineSegmentWithAI,
    confirmSegment,
    handleApplyMatch,
    handleApplyTerm,
    projectId,
    reloadEditorData,
  } = useEditor({ activeFileId: fileId });

  const {
    sourceQueryInput,
    targetQueryInput,
    matchMode,
    statusFilter,
    qualityFilters,
    quickPreset,
    sortBy,
    sortDirection,
    isFilterMenuOpen,
    isSortMenuOpen,
    filterMenuRef,
    sortMenuRef,
    filteredSegments,
    activeFilterCount,
    hasActiveFilter,
    toggleFilterMenu,
    toggleSortMenu,
    setSourceQueryInput,
    setTargetQueryInput,
    handleStatusFilterChange,
    handleMatchModeChange,
    toggleQualityFilter,
    applyQuickPreset,
    handleSortChange,
    clearFilters,
    debouncedSourceQuery,
    debouncedTargetQuery,
  } = useEditorFilters({
    fileId,
    segments,
    segmentSaveErrors,
    activeSegmentId,
    setActiveSegmentId,
  });

  const { layoutRef, sidebarWidth, startSidebarResize } = useEditorLayout();
  const {
    activeTab,
    setActiveTab,
    concordanceFocusSignal,
    concordanceSearchSignal,
    concordanceQuery,
  } = useConcordanceShortcut();

  const supportsBatchActions = project?.projectType === 'translation';
  const batchActions = useEditorBatchActions({
    fileId,
    fileName: file?.name || null,
    supportsBatchActions,
    reloadEditorData,
  });

  const totalSegments = segments.length;
  const confirmedSegments = segments.filter((segment) => segment.status === 'confirmed').length;
  const saveErrorCount = Object.keys(segmentSaveErrors).length;

  const syncSearchInputFocus = useCallback(() => {
    const active = document.activeElement;
    setIsSearchInputFocused(
      active === sourceSearchInputRef.current || active === targetSearchInputRef.current,
    );
  }, []);

  const handleSearchInputFocus = useCallback(() => {
    setIsSearchInputFocused(true);
  }, []);

  const handleSearchInputBlur = useCallback(() => {
    requestAnimationFrame(syncSearchInputFocus);
  }, [syncSearchInputFocus]);

  const handleRowActivate = useCallback(
    (segmentId: string, options?: { autoFocusTarget?: boolean }) => {
      setManualActivationSegmentId(segmentId);
      if (options?.autoFocusTarget === false) {
        setSuppressAutoFocusSegmentId(segmentId);
      } else {
        setSuppressAutoFocusSegmentId(null);
      }
      setActiveSegmentId(segmentId);
    },
    [setActiveSegmentId],
  );

  const handleRowAutoFocus = useCallback((segmentId: string) => {
    setManualActivationSegmentId((prev) => (prev === segmentId ? null : prev));
    setSuppressAutoFocusSegmentId((prev) => (prev === segmentId ? null : prev));
  }, []);

  useEffect(() => {
    const loadInfo = async () => {
      try {
        const loadedFile = await apiClient.getFile(fileId);
        if (loadedFile) {
          setFile(loadedFile);
          const loadedProject = await apiClient.getProject(loadedFile.projectId);
          setProject(loadedProject ?? null);
        }
      } catch (error) {
        console.error('Failed to load file info', error);
      }
    };

    void loadInfo();
  }, [fileId]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted text-text-faint">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-medium">Loading segments...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-muted">
      {supportsBatchActions && (
        <ProjectAITranslateModal
          open={batchActions.isBatchAIModalOpen}
          fileName={file?.name || null}
          onClose={batchActions.closeBatchAIModal}
          onConfirm={(options) => {
            void batchActions.handleBatchAITranslate(options);
          }}
        />
      )}

      <EditorHeader
        fileName={file?.name || null}
        projectName={project?.name || null}
        srcLang={project?.srcLang || null}
        tgtLang={project?.tgtLang || null}
        saveErrorCount={saveErrorCount}
        confirmedSegments={confirmedSegments}
        totalSegments={totalSegments}
        onBack={onBack}
        onExport={() => {
          void batchActions.handleExport();
        }}
      />

      <div ref={layoutRef as React.RefObject<HTMLDivElement>} className="flex-1 flex min-h-0">
        <div
          ref={listScrollRef}
          className="flex-1 overflow-y-auto bg-surface custom-scrollbar"
          style={{ scrollbarGutter: 'stable' }}
        >
          <div className="min-w-[800px]">
            <EditorFilterBar
              supportsBatchActions={supportsBatchActions}
              canRunActions={Boolean(file)}
              isBatchAITranslating={batchActions.isBatchAITranslating}
              isBatchQARunning={batchActions.isBatchQARunning}
              showNonPrintingSymbols={showNonPrintingSymbols}
              onOpenBatchAIModal={batchActions.openBatchAIModal}
              onRunBatchQA={() => {
                void batchActions.handleBatchQA();
              }}
              onToggleNonPrintingSymbols={() => setShowNonPrintingSymbols((prev) => !prev)}
              sortBy={sortBy}
              sortDirection={sortDirection}
              isSortMenuOpen={isSortMenuOpen}
              toggleSortMenu={toggleSortMenu}
              handleSortChange={handleSortChange}
              sourceQueryInput={sourceQueryInput}
              targetQueryInput={targetQueryInput}
              setSourceQueryInput={setSourceQueryInput}
              setTargetQueryInput={setTargetQueryInput}
              sourceSearchInputRef={sourceSearchInputRef}
              targetSearchInputRef={targetSearchInputRef}
              onSearchInputFocus={handleSearchInputFocus}
              onSearchInputBlur={handleSearchInputBlur}
              isFilterMenuOpen={isFilterMenuOpen}
              activeFilterCount={activeFilterCount}
              toggleFilterMenu={toggleFilterMenu}
              quickPreset={quickPreset}
              applyQuickPreset={applyQuickPreset}
              matchMode={matchMode}
              handleMatchModeChange={handleMatchModeChange}
              statusFilter={statusFilter}
              handleStatusFilterChange={handleStatusFilterChange}
              qualityFilters={qualityFilters}
              toggleQualityFilter={toggleQualityFilter}
              clearFilters={clearFilters}
              hasActiveFilter={hasActiveFilter}
              filterMenuRef={filterMenuRef}
              sortMenuRef={sortMenuRef}
            />

            <EditorListPane
              scrollParentRef={listScrollRef}
              virtualized={isVirtualizedListEnabled}
              filteredSegments={filteredSegments}
              activeSegmentId={activeSegmentId}
              manualActivationSegmentId={manualActivationSegmentId}
              suppressAutoFocusSegmentId={suppressAutoFocusSegmentId}
              isSearchInputFocused={isSearchInputFocused}
              onRowActivate={handleRowActivate}
              onRowAutoFocus={handleRowAutoFocus}
              onTranslationChange={handleTranslationChange}
              onTranslationBlur={flushSegmentDraft}
              onSegmentEditStateChange={handleSegmentEditStateChange}
              onAITranslate={translateSegmentWithAI}
              onAIRefine={refineSegmentWithAI}
              onConfirm={confirmSegment}
              aiTranslatingSegmentIds={aiTranslatingSegmentIds}
              segmentSaveErrors={segmentSaveErrors}
              sourceHighlightQuery={debouncedSourceQuery}
              targetHighlightQuery={debouncedTargetQuery}
              highlightMode={matchMode}
              showNonPrintingSymbols={showNonPrintingSymbols}
            />
          </div>
        </div>

        <EditorSidebar
          sidebarWidth={sidebarWidth}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onStartResize={(event) => {
            event.preventDefault();
            startSidebarResize();
          }}
          activeMatches={activeMatches}
          activeTerms={activeTerms}
          onApplyMatch={handleApplyMatch}
          onApplyTerm={handleApplyTerm}
          projectId={projectId || 0}
          concordanceFocusSignal={concordanceFocusSignal}
          concordanceQuery={concordanceQuery}
          concordanceSearchSignal={concordanceSearchSignal}
        />
      </div>
    </div>
  );
};
