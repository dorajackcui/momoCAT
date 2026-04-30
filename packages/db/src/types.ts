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
}

export interface TMConcordanceRecallOptions {
  scope?: 'source';
  limit?: number;
  rawLimit?: number;
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
