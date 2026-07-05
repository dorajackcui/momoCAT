import type { TBEntry, TMEntry } from '@cat/core/models';
import type { Project, ProjectFile } from '@cat/core/project';

export type TMType = 'working' | 'main';

export type ProjectListRecord = Project;

export interface FileSegmentStatusStats {
  totalSegments: number;
  qaProblemSegments: number;
  confirmedSegmentsForBar: number;
  inProgressSegments: number;
  newSegments: number;
}

export type ProjectFileRecord = ProjectFile & {
  importOptionsJson?: string | null;
  segmentStatusStats: FileSegmentStatusStats;
};

export interface ProjectSavedPromptRecord {
  id: number;
  projectId: number;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface TMRecord {
  id: string;
  name: string;
  srcLang: string;
  tgtLang: string;
  type: TMType;
  createdAt: string;
  updatedAt: string;
}

export interface MountedTMRecord extends TMRecord {
  priority: number;
  permission: string;
  isEnabled: number;
}

export interface TMEntryRow extends TMEntry {
  tmId: string;
}

export type TMRecallScope = 'source' | 'source-and-target';

export interface TMRecallOptions {
  scope?: TMRecallScope;
  limit?: number;
  profile?: 'english';
}

export interface TMConcordanceRecallOptions {
  scope?: 'source';
  limit?: number;
  rawLimit?: number;
  profile?: 'english';
}

/** One parsed spreadsheet row staged for an incremental TM file sync. */
export interface TMSyncStagedRow {
  srcHash: string;
  matchKey: string;
  tagsSignature: string;
  sourceTokensJson: string;
  targetTokensJson: string;
  srcText: string;
  tgtText: string;
}

export interface TMSyncChangedRow extends TMSyncStagedRow {
  entryId: string;
}

export interface TMSyncDiffSummary {
  added: number;
  changed: number;
  deleted: number;
  overwrittenLocalEdits: number;
  /** Entries missing from the file that were edited locally after the last full sync. */
  deletedLocalEdits: number;
}

export interface TBRecord {
  id: string;
  name: string;
  srcLang: string;
  tgtLang: string;
  createdAt: string;
  updatedAt: string;
}

export interface MountedTBRecord extends TBRecord {
  priority: number;
  isEnabled: number;
}

export type ProjectTermEntryRecord = TBEntry & {
  tbName: string;
  priority: number;
};
