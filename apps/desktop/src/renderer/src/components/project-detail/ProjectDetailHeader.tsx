import { useEffect, useRef } from 'react';
import type { Project } from '@cat/core/project';

export type ProjectDetailTab = 'files' | 'tm' | 'tb';

interface ProjectDetailHeaderProps {
  project: Project | null;
  loading: boolean;
  activeTab: ProjectDetailTab;
  onBack: () => void;
  onTabChange: (tab: ProjectDetailTab) => void;
  onOpenQASettings: () => void;
  isAddFileMenuOpen: boolean;
  onToggleAddFileMenu: () => void;
  onCloseAddFileMenu: () => void;
  onOpenFileImport: () => void;
  onOpenPasteSource: () => void;
}

export function ProjectDetailHeader({
  project,
  loading,
  activeTab,
  onBack,
  onTabChange,
  onOpenQASettings,
  isAddFileMenuOpen,
  onToggleAddFileMenu,
  onCloseAddFileMenu,
  onOpenFileImport,
  onOpenPasteSource,
}: ProjectDetailHeaderProps) {
  const addFileMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isAddFileMenuOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseAddFileMenu();
    };
    const closeOnOutsidePointer = (event: PointerEvent | MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && addFileMenuRef.current?.contains(target)) return;
      onCloseAddFileMenu();
    };

    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('mousedown', closeOnOutsidePointer);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('mousedown', closeOnOutsidePointer);
    };
  }, [isAddFileMenuOpen, onCloseAddFileMenu]);

  return (
    <div className="px-10 py-4 bg-surface/90 backdrop-blur border-b border-border flex items-center justify-between">
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 text-text-faint hover:text-text-muted hover:bg-muted rounded-control transition-colors"
          title="Back to Dashboard"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <div>
          <h2 className="text-xl font-bold text-text">
            {loading ? 'Loading...' : project?.name || 'Project Not Found'}
          </h2>
          {project ? <ProjectSummary project={project} /> : null}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <ProjectDetailTabs activeTab={activeTab} onTabChange={onTabChange} />
        <div className="h-6 w-[1px] bg-border" />
        {project && activeTab === 'files' ? (
          <div className="flex items-center gap-2">
            {project.projectType === 'translation' ? (
              <button
                onClick={onOpenQASettings}
                disabled={loading}
                className="btn-secondary !text-warning !bg-warning-soft hover:!bg-warning-soft/80"
              >
                QA Settings
              </button>
            ) : null}
            <div className="relative" ref={addFileMenuRef}>
              <button
                onClick={onToggleAddFileMenu}
                disabled={loading}
                className="btn-primary"
                aria-haspopup="menu"
                aria-expanded={isAddFileMenuOpen}
              >
                + Add File
              </button>
              {isAddFileMenuOpen ? (
                <div
                  className="absolute right-0 mt-2 w-40 surface-card p-1 shadow-float z-20"
                  role="menu"
                >
                  <AddFileMenuItem label="Import" onClick={onOpenFileImport} />
                  <AddFileMenuItem label="Paste" onClick={onOpenPasteSource} />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ProjectSummary({ project }: { project: Project }) {
  const projectTypeLabel =
    project.projectType === 'review'
      ? 'Review'
      : project.projectType === 'custom'
        ? 'Custom'
        : 'Translation';
  const projectTypeClass =
    project.projectType === 'review'
      ? 'bg-warning-soft/80 text-warning'
      : project.projectType === 'custom'
        ? 'bg-success-soft/80 text-success'
        : 'bg-brand-soft text-brand';

  return (
    <div className="text-xs text-text-muted flex items-center gap-2">
      <span>
        {project.srcLang} → {project.tgtLang}
      </span>
      <span className={`px-1.5 py-0.5 rounded-control font-semibold ${projectTypeClass}`}>
        {projectTypeLabel}
      </span>
    </div>
  );
}

function ProjectDetailTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: ProjectDetailTab;
  onTabChange: (tab: ProjectDetailTab) => void;
}) {
  return (
    <div className="flex surface-subtle p-1">
      <ProjectDetailTabButton
        label="Files"
        active={activeTab === 'files'}
        onClick={() => onTabChange('files')}
      />
      <ProjectDetailTabButton
        label="Translation Memory"
        active={activeTab === 'tm'}
        onClick={() => onTabChange('tm')}
      />
      <ProjectDetailTabButton
        label="Term Bases"
        active={activeTab === 'tb'}
        onClick={() => onTabChange('tb')}
      />
    </div>
  );
}

function ProjectDetailTabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 text-xs font-semibold rounded-control transition-colors ${
        active
          ? 'bg-surface text-brand shadow-panel'
          : 'text-text-muted hover:text-text hover:bg-surface'
      }`}
    >
      {label}
    </button>
  );
}

function AddFileMenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-2 text-sm font-semibold text-text-muted hover:text-text hover:bg-muted rounded-control"
      role="menuitem"
    >
      {label}
    </button>
  );
}
