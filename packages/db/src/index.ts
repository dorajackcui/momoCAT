import Database from "better-sqlite3";
import {
  QaIssue,
  Segment,
  SegmentStatus,
  TBEntry,
  TMEntry,
  Token,
} from "@cat/core/models";
import {
  Project,
  ProjectAIModel,
  ProjectQASettings,
  ProjectType,
} from "@cat/core/project";
import {
  MountedTBRecord,
  MountedTMRecord,
  ProjectFileRecord,
  ProjectListRecord,
  ProjectTermEntryRecord,
  TBRecord,
  TMEntryRow,
  TMRecord,
  TMType,
} from "./types";

import { ensureCurrentSchema } from './currentSchema';
import { ProjectRepo } from "./repos/ProjectRepo";
import { SegmentRepo } from "./repos/SegmentRepo";
import { SettingsRepo } from "./repos/SettingsRepo";
import { TBRepo } from "./repos/TBRepo";
import { TMRepo } from "./repos/TMRepo";
export * from "./types";
export { CURRENT_SCHEMA_VERSION, UnsupportedDatabaseSchemaError } from './currentSchema';

export class CATDatabase {
  private readonly db: Database.Database;
  private readonly projectRepo: ProjectRepo;
  private readonly segmentRepo: SegmentRepo;
  private readonly settingsRepo: SettingsRepo;
  private readonly tbRepo: TBRepo;
  private readonly tmRepo: TMRepo;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("temp_store = MEMORY");

    ensureCurrentSchema(this.db);

    this.projectRepo = new ProjectRepo(this.db);
    this.segmentRepo = new SegmentRepo(this.db, (fileId) =>
      this.projectRepo.updateFileStats(fileId),
    );
    this.settingsRepo = new SettingsRepo(this.db);
    this.tbRepo = new TBRepo(this.db);
    this.tmRepo = new TMRepo(this.db);
  }

  public createProject(
    name: string,
    srcLang: string,
    tgtLang: string,
    projectType: ProjectType = "translation",
  ): number {
    const projectId = this.projectRepo.createProject(
      name,
      srcLang,
      tgtLang,
      projectType,
    );

    if (projectType === "translation") {
      const workingTmId = this.tmRepo.createTM(
        `${name} (Working TM)`,
        srcLang,
        tgtLang,
        "working",
      );
      this.tmRepo.mountTMToProject(projectId, workingTmId, 0, "readwrite");
    }

    return projectId;
  }

  public listProjects(): (ProjectListRecord & {
    progress: number;
    fileCount: number;
  })[] {
    console.log("[DB] Listing projects");
    const projects = this.projectRepo.listProjects();

    return projects.map((project) => {
      const stats = this.segmentRepo.getProjectStats(project.id);
      const fileCount = this.projectRepo.countFilesByProject(project.id);

      const total = stats.reduce(
        (sum, statusStat) => sum + statusStat.count,
        0,
      );
      const confirmed =
        stats.find((statusStat) => statusStat.status === "confirmed")?.count ||
        0;
      const progress = total === 0 ? 0 : Math.round((confirmed / total) * 100);

      return { ...project, progress, fileCount };
    });
  }

  public getProject(id: number): Project | undefined {
    return this.projectRepo.getProject(id);
  }

  public updateProjectPrompt(projectId: number, aiPrompt: string | null) {
    this.projectRepo.updateProjectPrompt(projectId, aiPrompt);
  }

  public updateProjectAISettings(
    projectId: number,
    aiPrompt: string | null,
    aiModel: ProjectAIModel | null,
  ) {
    this.projectRepo.updateProjectAISettings(
      projectId,
      aiPrompt,
      aiModel,
    );
  }

  public updateProjectQASettings(
    projectId: number,
    qaSettings: ProjectQASettings,
  ) {
    this.projectRepo.updateProjectQASettings(projectId, qaSettings);
  }

  public deleteProject(id: number) {
    this.projectRepo.deleteProject(id);
  }

  public createFile(
    projectId: number,
    name: string,
    importOptionsJson?: string,
  ): number {
    return this.projectRepo.createFile(projectId, name, importOptionsJson);
  }

  public listFiles(projectId: number): ProjectFileRecord[] {
    return this.projectRepo.listFiles(projectId);
  }

  public getFile(id: number): ProjectFileRecord | undefined {
    return this.projectRepo.getFile(id);
  }

  public deleteFile(id: number) {
    this.projectRepo.deleteFile(id);
  }

  public updateFileStats(fileId: number) {
    this.projectRepo.updateFileStats(fileId);
  }

  public bulkInsertSegments(segments: Segment[]) {
    this.segmentRepo.bulkInsertSegments(segments);
  }

  public getProjectSegmentsByHash(
    projectId: number,
    srcHash: string,
  ): Segment[] {
    return this.segmentRepo.getProjectSegmentsByHash(projectId, srcHash);
  }

  public getSegmentsPage(
    fileId: number,
    offset: number,
    limit: number,
  ): Segment[] {
    return this.segmentRepo.getSegmentsPage(fileId, offset, limit);
  }

  public getSegment(segmentId: string): Segment | undefined {
    return this.segmentRepo.getSegment(segmentId);
  }

  public getProjectIdByFileId(fileId: number): number | undefined {
    return this.projectRepo.getProjectIdByFileId(fileId);
  }

  public getProjectTypeByFileId(fileId: number): ProjectType | undefined {
    return this.projectRepo.getProjectTypeByFileId(fileId);
  }

  public updateSegmentTarget(
    segmentId: string,
    targetTokens: Token[],
    status: SegmentStatus,
  ) {
    this.segmentRepo.updateSegmentTarget(segmentId, targetTokens, status);
  }

  public updateSegmentQaIssues(segmentId: string, qaIssues: QaIssue[]) {
    this.segmentRepo.updateSegmentQaIssues(segmentId, qaIssues);
  }

  public getProjectStats(
    projectId: number,
  ): { status: string; count: number }[] {
    return this.segmentRepo.getProjectStats(projectId);
  }

  public runInTransaction<T>(fn: () => T): T {
    return this.segmentRepo.runInTransaction(fn);
  }

  public getSetting(key: string): string | undefined {
    return this.settingsRepo.getSetting(key);
  }

  public setSetting(key: string, value: string | null) {
    this.settingsRepo.setSetting(key, value);
  }

  public listTermBases(): TBRecord[] {
    return this.tbRepo.listTermBases();
  }

  public createTermBase(
    name: string,
    srcLang: string,
    tgtLang: string,
  ): string {
    return this.tbRepo.createTermBase(name, srcLang, tgtLang);
  }

  public deleteTermBase(id: string) {
    this.tbRepo.deleteTermBase(id);
  }

  public getTermBase(tbId: string): TBRecord | undefined {
    return this.tbRepo.getTermBase(tbId);
  }

  public getTermBaseStats(tbId: string) {
    return this.tbRepo.getTermBaseStats(tbId);
  }

  public mountTermBaseToProject(
    projectId: number,
    tbId: string,
    priority: number = 10,
  ) {
    this.tbRepo.mountTermBaseToProject(projectId, tbId, priority);
  }

  public unmountTermBaseFromProject(projectId: number, tbId: string) {
    this.tbRepo.unmountTermBaseFromProject(projectId, tbId);
  }

  public getProjectMountedTermBases(projectId: number): MountedTBRecord[] {
    return this.tbRepo.getProjectMountedTermBases(projectId);
  }

  public listTBEntries(
    tbId: string,
    limit: number = 500,
    offset: number = 0,
  ): TBEntry[] {
    return this.tbRepo.listTBEntries(tbId, limit, offset);
  }

  public listProjectTermEntries(projectId: number): ProjectTermEntryRecord[] {
    return this.tbRepo.listProjectTermEntries(projectId);
  }

  public searchProjectTermEntries(
    projectId: number,
    sourceText: string,
    options?: { srcLang?: string; limit?: number },
  ): ProjectTermEntryRecord[] {
    return this.tbRepo.searchProjectTermEntries(projectId, sourceText, options);
  }

  public insertTBEntryIfAbsentBySrcTerm(params: {
    id: string;
    tbId: string;
    srcLang: string;
    srcTerm: string;
    tgtTerm: string;
    note?: string | null;
    usageCount?: number;
  }): string | undefined {
    return this.tbRepo.insertTBEntryIfAbsentBySrcTerm(params);
  }

  public upsertTBEntryBySrcTerm(params: {
    id: string;
    tbId: string;
    srcLang: string;
    srcTerm: string;
    tgtTerm: string;
    note?: string | null;
    usageCount?: number;
  }): string {
    return this.tbRepo.upsertTBEntryBySrcTerm(params);
  }

  public incrementTBUsage(tbEntryId: string) {
    this.tbRepo.incrementTBUsage(tbEntryId);
  }

  public upsertTMEntry(entry: TMEntry & { tmId: string }) {
    this.tmRepo.upsertTMEntry(entry);
  }

  public insertTMEntryIfAbsentBySrcHash(
    entry: TMEntry & { tmId: string },
  ): string | undefined {
    return this.tmRepo.insertTMEntryIfAbsentBySrcHash(entry);
  }

  public upsertTMEntryBySrcHash(entry: TMEntry & { tmId: string }): string {
    return this.tmRepo.upsertTMEntryBySrcHash(entry);
  }

  public insertTMFts(
    tmId: string,
    srcText: string,
    tgtText: string,
    tmEntryId: string,
  ) {
    this.tmRepo.insertTMFts(tmId, srcText, tgtText, tmEntryId);
  }

  public replaceTMFts(
    tmId: string,
    srcText: string,
    tgtText: string,
    tmEntryId: string,
  ) {
    this.tmRepo.replaceTMFts(tmId, srcText, tgtText, tmEntryId);
  }

  public findTMEntryByHash(tmId: string, srcHash: string): TMEntry | undefined {
    return this.tmRepo.findTMEntryByHash(tmId, srcHash);
  }

  public findTMEntryMetaByHash(
    tmId: string,
    srcHash: string,
  ): { id: string; usageCount: number; createdAt: string } | undefined {
    return this.tmRepo.findTMEntryMetaByHash(tmId, srcHash);
  }

  public getProjectMountedTMs(projectId: number): MountedTMRecord[] {
    return this.tmRepo.getProjectMountedTMs(projectId);
  }

  public searchConcordance(projectId: number, query: string): TMEntryRow[] {
    return this.tmRepo.searchConcordance(projectId, query);
  }

  public listTMs(type?: TMType): TMRecord[] {
    return this.tmRepo.listTMs(type);
  }

  public createTM(
    name: string,
    srcLang: string,
    tgtLang: string,
    type: TMType,
  ): string {
    return this.tmRepo.createTM(name, srcLang, tgtLang, type);
  }

  public deleteTM(id: string) {
    this.tmRepo.deleteTM(id);
  }

  public mountTMToProject(
    projectId: number,
    tmId: string,
    priority: number = 10,
    permission: string = "read",
  ) {
    this.tmRepo.mountTMToProject(projectId, tmId, priority, permission);
  }

  public unmountTMFromProject(projectId: number, tmId: string) {
    this.tmRepo.unmountTMFromProject(projectId, tmId);
  }

  public getTMStats(tmId: string) {
    return this.tmRepo.getTMStats(tmId);
  }

  public getTM(tmId: string): TMRecord | undefined {
    return this.tmRepo.getTM(tmId);
  }

  public close() {
    this.db.close();
  }
}
