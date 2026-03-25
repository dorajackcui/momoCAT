import React, { useState } from 'react';
import type { ProjectType } from '@cat/core/project';
import { CreateProjectModal } from './CreateProjectModal';
import { ProjectWithStats } from '../hooks/useProjects';

interface DashboardProps {
  projects: ProjectWithStats[];
  loading?: boolean;
  onOpenProject: (id: number) => void;
  onCreateProject: (
    name: string,
    srcLang: string,
    tgtLang: string,
    projectType: ProjectType,
  ) => void;
  onDeleteProject: (id: number) => void;
}

export function Dashboard({
  projects,
  loading,
  onOpenProject,
  onCreateProject,
  onDeleteProject,
}: DashboardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleConfirmCreate = async (
    name: string,
    srcLang: string,
    tgtLang: string,
    projectType: ProjectType,
  ) => {
    await onCreateProject(name, srcLang, tgtLang, projectType);
    setIsModalOpen(false);
  };

  return (
    <div className="p-10 max-w-[1024px] mx-auto h-full overflow-y-auto relative custom-scrollbar">
      <CreateProjectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConfirm={handleConfirmCreate}
        loading={!!loading}
      />

      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold text-text">Projects</h1>
        <button onClick={() => setIsModalOpen(true)} className="btn-primary !px-5 !py-2.5">
          + Create Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="text-center p-20 surface-subtle border-dashed text-text-muted">
          <div className="text-6xl mb-6">📁</div>
          <h3 className="text-xl font-semibold mb-2">No projects yet</h3>
          <p>Create a project to start translating your documents.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <div
              key={project.id}
              className="surface-card p-6 flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-float border-t-2 border-t-brand/50"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-text truncate" title={project.name}>
                    {project.name}
                  </h3>
                  <div className="text-xs text-text-muted mt-1 flex items-center gap-2">
                    <span className="bg-brand-soft text-brand px-2 py-0.5 rounded-control font-semibold">
                      {project.fileCount || 0} Files
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-control font-semibold ${
                        project.projectType === 'review'
                          ? 'bg-warning-soft text-warning'
                          : project.projectType === 'custom'
                            ? 'bg-success-soft text-success'
                            : 'bg-muted text-text-muted'
                      }`}
                    >
                      {project.projectType === 'review'
                        ? 'Review'
                        : project.projectType === 'custom'
                          ? 'Custom'
                          : 'Translation'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteProject(project.id);
                  }}
                  className="p-1.5 text-text-faint hover:text-danger hover:bg-danger-soft rounded-control transition-colors ml-2"
                  title="Delete Project"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>

              <div className="mb-6">
                <div className="flex justify-between text-[10px] font-semibold mb-2 text-text-faint uppercase tracking-tight">
                  <span>Total Progress</span>
                  <span>{project.progress}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand rounded-full transition-all duration-500"
                    style={{ width: `${project.progress}%` }}
                  />
                </div>
              </div>

              <div className="mt-auto">
                <button
                  onClick={() => onOpenProject(project.id)}
                  className="btn-primary w-full !py-2.5"
                >
                  Open
                </button>
                <div className="mt-2 text-[10px] text-text-faint text-right">
                  {project.createdAt
                    ? `Created ${new Date(project.createdAt).toLocaleString()}`
                    : 'Created time unavailable'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
