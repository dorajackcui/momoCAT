import { useRef } from 'react';
import { Menu, MenuItem, TabsList, Button, Badge } from '../ui';
import type { Project } from '@cat/core/project';

export type ProjectDetailTab = 'files' | 'tm' | 'tb' | 'qa' | 'settings';

interface ProjectDetailHeaderProps {
  project: Project | null;
  loading: boolean;
  activeTab: ProjectDetailTab;
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
            { value: 'settings', label: 'AI provider' },
            { value: 'tm', label: 'Translation memory' },
            { value: 'tb', label: 'Term bases' },
            { value: 'qa', label: 'QA' },
          ]}
        />
        {project && activeTab === 'files' ? (
          <div className="flex items-center gap-2">
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
  return (
    <div className="text-xs text-text-muted flex items-center gap-2">
      <span>
        {project.srcLang} → {project.tgtLang}
      </span>
      <Badge tone="neutral">{projectTypeLabel}</Badge>
    </div>
  );
}
