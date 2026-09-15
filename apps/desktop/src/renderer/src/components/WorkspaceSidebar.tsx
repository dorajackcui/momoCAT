import { useCallback, useId, useState } from 'react';
import type { Project, ProjectType } from '@cat/core/project';
import type { WorkspaceView } from '../hooks/useWorkspaceNavigation';
import { WorkspaceActionMenu } from './WorkspaceActionMenu';

type IconName = 'project' | 'plus' | 'tm' | 'tb' | 'settings' | 'trash';

const projectTypeLabels: Record<ProjectType, string> = {
  translation: 'Translation',
  review: 'Review',
  custom: 'Custom',
};

function NavIcon({
  name,
  projectType = 'translation',
}: {
  name: IconName;
  projectType?: ProjectType;
}) {
  const paths: Record<IconName, string> = {
    project: 'M3.5 5h6l2 2h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
    plus: 'M12 5v14 M5 12h14',
    trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v5 M14 11v5',
    tm: 'M4 5h16v11H9l-5 4z M8 9h8 M8 12h5',
    tb: 'M4 4h7l1 2 1-2h7v15h-7l-1 2-1-2H4z M12 6v15',
    settings:
      'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M5.6 18.4l2.1-2.1 M16.3 7.7l2.1-2.1 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  };
  return (
    <svg
      className={name === 'project' ? 'h-[22px] w-[22px] shrink-0' : 'h-[18px] w-[18px] shrink-0'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
      {name === 'project' && (
        <text
          x="12"
          y="17"
          textAnchor="middle"
          fill="currentColor"
          stroke="none"
          fontSize="10"
          fontWeight="700"
        >
          {projectTypeLabels[projectType][0]}
        </text>
      )}
    </svg>
  );
}

interface WorkspaceSidebarProps {
  projects: Project[];
  view: WorkspaceView;
  disabled: boolean;
  hidden?: boolean;
  onNavigate: (view: WorkspaceView) => void;
  onCreate: () => void;
  onDelete: (project: Project) => void;
}

export function WorkspaceSidebar({
  projects,
  view,
  disabled,
  hidden = false,
  onNavigate,
  onCreate,
  onDelete,
}: WorkspaceSidebarProps) {
  const [menu, setMenu] = useState<{ projectId: number; anchor: HTMLElement } | null>(null);
  const menuId = useId();
  const closeMenu = useCallback(() => setMenu(null), []);
  const activeProjectId = 'projectId' in view ? view.projectId : null;
  const menuProject = projects.find((project) => project.id === menu?.projectId);
  const openProject = (project: Project) => {
    closeMenu();
    onNavigate({ kind: 'project', projectId: project.id! });
  };

  const navItem = (kind: 'tm' | 'tb' | 'settings', label: string, icon: IconName) => (
    <button
      type="button"
      className="workspace-nav-item"
      aria-current={view.kind === kind ? 'page' : undefined}
      aria-label={label}
      disabled={disabled}
      onClick={() => onNavigate({ kind })}
    >
      <NavIcon name={icon} />
      <span>{label}</span>
    </button>
  );

  return (
    <aside hidden={hidden} className="workspace-sidebar" aria-label="Workspace navigation">
      <div className="workspace-sidebar-brand">
        <button
          type="button"
          className="workspace-brand"
          disabled={disabled}
          onClick={() => onNavigate({ kind: 'home' })}
        >
          MomoCAT<span className="text-brand">.</span>
        </button>
      </div>
      <button
        type="button"
        className="workspace-nav-item"
        onClick={onCreate}
        disabled={disabled}
        title="New project"
        aria-label="New project"
      >
        <NavIcon name="plus" />
        <span>New project</span>
      </button>
      <div className="workspace-project-heading">Projects</div>
      <nav className="workspace-project-list custom-scrollbar" aria-label="Projects">
        {projects.map((project) => (
          <div key={project.id} className="workspace-project">
            <button
              type="button"
              className="workspace-nav-item"
              disabled={disabled}
              aria-current={activeProjectId === project.id ? 'page' : undefined}
              aria-label={project.name}
              aria-description={`${projectTypeLabels[project.projectType ?? 'translation']} project`}
              title={`${project.name} · ${projectTypeLabels[project.projectType ?? 'translation']}`}
              onClick={() => openProject(project)}
            >
              <NavIcon name="project" projectType={project.projectType} />
              <span className="truncate">{project.name}</span>
            </button>
            <button
              type="button"
              className="workspace-project-more"
              disabled={disabled}
              aria-label={`Actions for ${project.name}`}
              aria-expanded={menu?.projectId === project.id}
              aria-haspopup="menu"
              aria-controls={menu?.projectId === project.id ? menuId : undefined}
              onClick={(event) =>
                setMenu(
                  menu?.projectId === project.id
                    ? null
                    : { projectId: project.id!, anchor: event.currentTarget },
                )
              }
            >
              ···
            </button>
          </div>
        ))}
        {projects.length === 0 && (
          <p className="px-3 text-xs text-text-faint">Your projects will appear here.</p>
        )}
      </nav>
      <nav className="workspace-resource-nav" aria-label="Resources">
        {navItem('tm', 'Translation memory', 'tm')}
        {navItem('tb', 'Term bases', 'tb')}
      </nav>
      <div className="workspace-settings-nav">{navItem('settings', 'Settings', 'settings')}</div>
      {disabled && (
        <span className="sr-only" role="status">
          Loading workspace…
        </span>
      )}
      {!hidden && menu && menuProject && (
        <WorkspaceActionMenu
          id={menuId}
          label={`${menuProject.name} actions`}
          anchor={menu.anchor}
          onClose={closeMenu}
        >
          <div className="workspace-menu-heading">{menuProject.name}</div>
          <button
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={() => openProject(menuProject)}
          >
            <NavIcon name="project" projectType={menuProject.projectType} />
            <span>Open project</span>
          </button>
          <div role="separator" className="workspace-menu-separator" />
          <button
            type="button"
            role="menuitem"
            className="workspace-menu-danger"
            disabled={disabled}
            onClick={() => {
              closeMenu();
              onDelete(menuProject);
            }}
          >
            <NavIcon name="trash" />
            <span>Delete project…</span>
          </button>
        </WorkspaceActionMenu>
      )}
    </aside>
  );
}
