export type Cell = string | number | null;
export type Row = Record<string, Cell>;

export interface CloudProjectRecordV2 {
  uuid: string;
  name: string;
  srcLang: string;
  tgtLang: string;
  projectType: string;
  aiPrompt: string | null;
  aiTemperature: number | null;
  aiModel: string;
  qaSettingsJson: string;
  createdAt: string;
  updatedAt: string;
}
export interface CloudFileRecordV2 {
  uuid: string;
  name: string;
  totalSegments: number;
  confirmedSegments: number;
  importOptionsJson: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface CloudSegmentRecordV2 {
  segmentId: string;
  fileUUID: string;
  orderIndex: number;
  sourceTokensJson: string;
  targetTokensJson: string;
  status: string;
  tagsSignature: string;
  matchKey: string;
  srcHash: string;
  metaJson: string;
  qaIssuesJson: string | null;
  updatedAt: string;
}
export interface CloudPromptRecordV2 {
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}
export interface CloudTMRecordV2 {
  id: string;
  name: string;
  srcLang: string;
  tgtLang: string;
  type: 'main' | 'working';
  createdAt: string;
  updatedAt: string;
}
export type CloudTBRecordV2 = Omit<CloudTMRecordV2, 'type'>;
export interface CloudTMEntryV2 {
  id: string;
  tmId: string;
  srcHash: string;
  matchKey: string;
  tagsSignature: string;
  sourceTokensJson: string;
  targetTokensJson: string;
  originSegmentId: string | null;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
}
export interface CloudTBEntryV2 {
  id: string;
  tbId: string;
  srcTerm: string;
  tgtTerm: string;
  srcNorm: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
}
export interface CloudTMMountV2 {
  tmId: string;
  priority: number;
  permission: string;
  isEnabled: number;
}
export interface CloudTBMountV2 {
  tbId: string;
  priority: number;
  isEnabled: number;
}
export interface ProjectSnapshotV2 {
  protocol: 2;
  sourceSQLite: 15;
  kind: 'project';
  project: CloudProjectRecordV2;
  files: CloudFileRecordV2[];
  segments: CloudSegmentRecordV2[];
  prompts: CloudPromptRecordV2[];
  workingTM: { resource: CloudTMRecordV2; entries: CloudTMEntryV2[] } | null;
  mounts: { tms: CloudTMMountV2[]; tbs: CloudTBMountV2[] };
}
export type ResourceSnapshotV2 = {
  protocol: 2;
  sourceSQLite: 15;
} & (
  | { kind: 'tm'; resource: CloudTMRecordV2; entries: CloudTMEntryV2[] }
  | { kind: 'tb'; resource: CloudTBRecordV2; entries: CloudTBEntryV2[] }
);
export type CloudSnapshotAfterRestore = (
  projectId: number,
  files: { id: number; uuid: string; name: string; projectId: number; sourceUUID?: string }[],
) => void | { installationId: string };

// Transport only authoritative fields. In particular, local integer IDs,
// FTS rowids, settings, linked paths, scratch state and credentials never travel.
export const columns = {
  projects:
    'uuid,name,srcLang,tgtLang,projectType,aiPrompt,aiTemperature,aiModel,qaSettingsJson,createdAt,updatedAt',
  files: 'uuid,name,totalSegments,confirmedSegments,importOptionsJson,createdAt,updatedAt',
  segments:
    'segmentId,orderIndex,sourceTokensJson,targetTokensJson,status,tagsSignature,matchKey,srcHash,metaJson,qaIssuesJson,updatedAt',
  project_prompts: 'name,content,createdAt,updatedAt',
  tms: 'id,name,srcLang,tgtLang,type,createdAt,updatedAt',
  term_bases: 'id,name,srcLang,tgtLang,createdAt,updatedAt',
  tm_entries:
    'id,tmId,srcHash,matchKey,tagsSignature,sourceTokensJson,targetTokensJson,originSegmentId,createdAt,updatedAt,usageCount',
  tb_entries: 'id,tbId,srcTerm,tgtTerm,srcNorm,note,createdAt,updatedAt,usageCount',
  project_tms: 'tmId,priority,permission,isEnabled',
  project_term_bases: 'tbId,priority,isEnabled',
} as const;
export type Table = keyof typeof columns;
