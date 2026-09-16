import { useRef } from 'react';
import { Menu, MenuItem, TabsList, Button } from '../ui';
import type { Project } from '@cat/core/project';

export type ProjectDetailTab = 'files' | 'tm' | 'tb';

interface ProjectDetailHeaderProps {
  project: Project | null;
  loading: boolean;
  activeTab: ProjectDetailTab;
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
  onOpenQASettings,
  isAddFileMenuOpen,
  onToggleAddFileMenu,
  onCloseAddFileMenu,
  onOpenFileImport,
  onOpenPasteSource,
}: ProjectDetailHeaderProps) {
  const addFileMenuRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="workspace-project-header">
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-text truncate">
            {loading ? 'Loading...' : project?.name || 'Project Not Found'}
          </h2>
          {project ? <ProjectSummary project={project} /> : null}
        </div>
      </div>

      <div className="workspace-project-toolbar">
        <TabsList
          label="Project sections"
          items={[
            { value: 'files', label: 'Tasks' },
            { value: 'tm', label: 'Translation Memory' },
            { value: 'tb', label: 'Term Bases' },
          ]}
        />
        {project && activeTab === 'files' ? (
          <div className="flex items-center gap-2">
            {project.projectType === 'translation' ? (
              <Button variant="secondary" onClick={onOpenQASettings} disabled={loading}>
                QA Settings
              </Button>
            ) : null}
            <div className="relative">
              <Button
                variant="primary"
                ref={addFileMenuRef}
                onClick={onToggleAddFileMenu}
                disabled={loading}
                aria-haspopup="menu"
                aria-expanded={isAddFileMenuOpen}
              >
                + Add File
              </Button>
              {isAddFileMenuOpen ? (
                <Menu
                  anchor={addFileMenuRef}
                  onClose={onCloseAddFileMenu}
                  label="Add file"
                  className="w-40"
                >
                  <MenuItem onClick={onOpenFileImport}>Import</MenuItem>
                  <MenuItem onClick={onOpenPasteSource}>Paste</MenuItem>
                </Menu>
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
