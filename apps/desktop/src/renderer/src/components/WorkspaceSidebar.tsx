import { useCallback, useEffect, useId, useState } from 'react';
import type { Project, ProjectType } from '@cat/core/project';
import type { WorkspaceView } from '../hooks/useWorkspaceNavigation';
import { Icon, IconButton, Menu, MenuItem, MenuHeading, MenuSeparator } from './ui';

type IconName = 'project' | 'plus' | 'pin' | 'tm' | 'tb' | 'settings' | 'trash';

interface WorkspaceSidebarPreferences {
  pinnedProjectIds: number[];
  pinnedCollapsed: boolean;
  projectsCollapsed: boolean;
}

const WORKSPACE_SIDEBAR_STORAGE_KEY = 'workspace.sidebar.preferences';
const DEFAULT_WORKSPACE_SIDEBAR_PREFERENCES: WorkspaceSidebarPreferences = {
  pinnedProjectIds: [],
  pinnedCollapsed: false,
  projectsCollapsed: false,
};

function readWorkspaceSidebarPreferences(): WorkspaceSidebarPreferences {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_SIDEBAR_STORAGE_KEY);
    if (!raw) return DEFAULT_WORKSPACE_SIDEBAR_PREFERENCES;
    const stored = JSON.parse(raw) as Partial<WorkspaceSidebarPreferences>;
    const pinnedProjectIds = Array.isArray(stored.pinnedProjectIds)
      ? [
          ...new Set(
            stored.pinnedProjectIds.filter(
              (projectId): projectId is number => Number.isInteger(projectId) && projectId > 0,
            ),
          ),
        ]
      : [];
    return {
      pinnedProjectIds,
      pinnedCollapsed: stored.pinnedCollapsed === true,
      projectsCollapsed: stored.projectsCollapsed === true,
    };
  } catch {
    return DEFAULT_WORKSPACE_SIDEBAR_PREFERENCES;
  }
}

function persistWorkspaceSidebarPreferences(preferences: WorkspaceSidebarPreferences): void {
  try {
    window.localStorage.setItem(WORKSPACE_SIDEBAR_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Sidebar preferences are optional; navigation remains usable without persistence.
  }
}

const projectTypeLabels: Record<ProjectType, string> = {
  translation: 'Translation',
  custom: 'Custom',
};

function NavIcon({
  name,
  projectType = 'translation',
}: {
  name: IconName;
  projectType?: ProjectType;
}) {
  if (name === 'tm' || name === 'tb' || name === 'settings') {
    const sharedIcons = { tm: 'database', tb: 'book-open', settings: 'settings-2' } as const;
    return (
      <Icon name={sharedIcons[name]} className="h-[18px] w-[18px] shrink-0" strokeWidth="1.6" />
    );
  }
  const paths: Record<Exclude<IconName, 'tm' | 'tb' | 'settings'>, string> = {
    project: 'M3.5 5h6l2 2h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
    plus: 'M12 5v14 M5 12h14',
    pin: 'M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z M12 14v7',
    trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v5 M14 11v5',
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
          className="text-caption font-bold"
        >
          {projectTypeLabels[projectType][0]}
        </text>
      )}
    </svg>
  );
}

function SectionChevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      className={`workspace-project-heading-chevron ${collapsed ? '' : 'rotate-90'}`}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 3 5 5-5 5" />
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
  const [preferences, setPreferences] = useState(readWorkspaceSidebarPreferences);
  const menuId = useId();
  const closeMenu = useCallback(() => setMenu(null), []);
  const activeProjectId = 'projectId' in view ? view.projectId : null;
  const menuProject = projects.find((project) => project.id === menu?.projectId);
  const pinnedProjectIds = new Set(preferences.pinnedProjectIds);
  const pinnedProjects = projects.filter(
    (project) => project.id && pinnedProjectIds.has(project.id),
  );
  const regularProjects = projects.filter(
    (project) => !project.id || !pinnedProjectIds.has(project.id),
  );

  useEffect(() => {
    persistWorkspaceSidebarPreferences(preferences);
  }, [preferences]);

  const openProject = (project: Project) => {
    closeMenu();
    onNavigate({ kind: 'project', projectId: project.id! });
  };

  const toggleProjectPin = (project: Project) => {
    if (!project.id) return;
    closeMenu();
    setPreferences((current) => ({
      ...current,
      pinnedProjectIds: current.pinnedProjectIds.includes(project.id!)
        ? current.pinnedProjectIds.filter((projectId) => projectId !== project.id)
        : [...current.pinnedProjectIds, project.id!],
    }));
  };

  const toggleSection = (section: 'pinned' | 'projects') => {
    setPreferences((current) =>
      section === 'pinned'
        ? { ...current, pinnedCollapsed: !current.pinnedCollapsed }
        : { ...current, projectsCollapsed: !current.projectsCollapsed },
    );
  };

  const renderProject = (project: Project) => (
    <div
      key={project.id}
      className="workspace-project"
      data-pinned={pinnedProjectIds.has(project.id!)}
    >
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
  );

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
          momoCAT<span className="workspace-brand-dot">.</span>
        </button>
        <IconButton
          variant="ghost"
          size="sm"
          onClick={onCreate}
          disabled={disabled}
          title="New project"
          aria-label="New project"
        >
          <NavIcon name="plus" />
        </IconButton>
      </div>
      <nav className="workspace-project-list custom-scrollbar" aria-label="Projects">
        {pinnedProjects.length > 0 && (
          <div className="workspace-project-section">
            <button
              type="button"
              className="workspace-project-heading"
              aria-expanded={!preferences.pinnedCollapsed}
              aria-label={`${preferences.pinnedCollapsed ? 'Expand' : 'Collapse'} Pinned projects`}
              onClick={() => toggleSection('pinned')}
            >
              <span>Pinned</span>
              <SectionChevron collapsed={preferences.pinnedCollapsed} />
            </button>
            {!preferences.pinnedCollapsed && (
              <div role="group" aria-label="Pinned projects">
                {pinnedProjects.map(renderProject)}
              </div>
            )}
          </div>
        )}
        <div className="workspace-project-section">
          <button
            type="button"
            className="workspace-project-heading"
            aria-expanded={!preferences.projectsCollapsed}
            aria-label={`${preferences.projectsCollapsed ? 'Expand' : 'Collapse'} Projects`}
            onClick={() => toggleSection('projects')}
          >
            <span>Projects</span>
            <SectionChevron collapsed={preferences.projectsCollapsed} />
          </button>
          {!preferences.projectsCollapsed && (
            <div role="group" aria-label="Projects list">
              {regularProjects.map(renderProject)}
              {projects.length === 0 && (
                <p className="px-3 py-1 text-xs text-text-faint">Your projects will appear here.</p>
              )}
            </div>
          )}
        </div>
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
        <Menu
          id={menuId}
          label={`${menuProject.name} actions`}
          anchor={menu.anchor}
          onClose={closeMenu}
        >
          <MenuHeading>{menuProject.name}</MenuHeading>
          <MenuItem type="button" disabled={disabled} onClick={() => openProject(menuProject)}>
            <NavIcon name="project" projectType={menuProject.projectType} />
            <span>Open project</span>
          </MenuItem>
          <MenuItem type="button" disabled={disabled} onClick={() => toggleProjectPin(menuProject)}>
            <NavIcon name="pin" />
            <span>{pinnedProjectIds.has(menuProject.id!) ? 'Unpin project' : 'Pin project'}</span>
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            type="button"
            danger
            disabled={disabled}
            onClick={() => {
              closeMenu();
              onDelete(menuProject);
            }}
          >
            <NavIcon name="trash" />
            <span>Delete project…</span>
          </MenuItem>
        </Menu>
      )}
    </aside>
  );
}
