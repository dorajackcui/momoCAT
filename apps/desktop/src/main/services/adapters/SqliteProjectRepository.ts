import type { ProjectAIModel, ProjectQASettings, ProjectType } from '@cat/core/project';
import { CATDatabase } from '@cat/db';
import { ProjectRepository, ProjectFileRecord, ProjectListRecord, ProjectRecord } from '../ports';

export class SqliteProjectRepository implements ProjectRepository {
  constructor(private readonly db: CATDatabase) {}

  createProject(
    name: string,
    srcLang: string,
    tgtLang: string,
    projectType: ProjectType = 'translation',
  ): number {
    return this.db.createProject(name, srcLang, tgtLang, projectType);
  }

  listProjects(): ProjectListRecord[] {
    return this.db.listProjects();
  }

  getProject(id: number): ProjectRecord | undefined {
    return this.db.getProject(id);
  }

  updateProjectPrompt(projectId: number, aiPrompt: string | null): void {
    this.db.updateProjectPrompt(projectId, aiPrompt);
  }

  updateProjectAISettings(
    projectId: number,
    aiPrompt: string | null,
    aiTemperature: number | null,
    aiModel: ProjectAIModel | null,
  ): void {
    this.db.updateProjectAISettings(projectId, aiPrompt, aiTemperature, aiModel);
  }

  updateProjectQASettings(projectId: number, qaSettings: ProjectQASettings): void {
    this.db.updateProjectQASettings(projectId, qaSettings);
  }

  deleteProject(id: number): void {
    this.db.deleteProject(id);
  }

  createFile(projectId: number, name: string, importOptionsJson?: string): number {
    return this.db.createFile(projectId, name, importOptionsJson);
  }

  listFiles(projectId: number): ProjectFileRecord[] {
    return this.db.listFiles(projectId);
  }

  getFile(id: number): ProjectFileRecord | undefined {
    return this.db.getFile(id);
  }

  deleteFile(id: number): void {
    this.db.deleteFile(id);
  }
}
