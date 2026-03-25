import { useState, useEffect, useCallback } from 'react';
import type { Project, ProjectType } from '@cat/core/project';
import { apiClient } from '../services/apiClient';
import { feedbackService } from '../services/feedbackService';

export interface ProjectWithStats extends Project {
  progress: number;
  fileCount: number;
}

export function useProjects() {
  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [loading, setLoading] = useState(false);

  const loadProjects = useCallback(async () => {
    try {
      const list = await apiClient.listProjects();
      setProjects(list);
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const createProject = async (
    name: string,
    srcLang: string,
    tgtLang: string,
    projectType: ProjectType = 'translation',
  ) => {
    console.log('[useProjects] createProject triggered:', name);

    setLoading(true);
    try {
      const newProject = await apiClient.createProject(name, srcLang, tgtLang, projectType);
      await loadProjects();
      return newProject;
    } catch (error) {
      console.error('Failed to create project:', error);
      feedbackService.error(
        `Failed to create project: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    } finally {
      setLoading(false);
    }
  };

  const deleteProject = async (projectId: number) => {
    const confirmed = await feedbackService.confirm(
      'Are you sure you want to delete this project? This will remove all files and translations.',
    );
    if (!confirmed) return;

    setLoading(true);
    try {
      await apiClient.deleteProject(projectId);
      await loadProjects();
    } catch (error) {
      console.error('Failed to delete project:', error);
      feedbackService.error('Failed to delete project');
    } finally {
      setLoading(false);
    }
  };

  return {
    projects,
    loading,
    loadProjects,
    createProject,
    deleteProject,
  };
}
