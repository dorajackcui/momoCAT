import type { Token } from '@cat/core/models';
import {
  columns,
  type Row,
  type CloudTMEntryV2,
  type CloudTMRecordV2,
  type ProjectSnapshotV2,
  type ResourceSnapshotV2,
} from './CloudAccountSnapshotFormat';

const MAX_ROWS = 500_000;

function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid snapshot object');
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error('Invalid snapshot object');
  return input as Record<string, unknown>;
}
function exact(input: unknown, keys: string[]): Record<string, unknown> {
  const value = object(input);
  if (Object.keys(value).length !== keys.length || !keys.every((key) => Object.hasOwn(value, key)))
    throw new Error('Invalid snapshot columns');
  return value;
}
function text(value: unknown, nonempty = false): asserts value is string {
  if (typeof value !== 'string' || (nonempty && !value.trim()))
    throw new Error('Invalid snapshot text');
}
function identity(value: unknown): asserts value is string {
  text(value, true);
  if (
    value.length > 512 ||
    /[\\/]/u.test(value) ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    value === '.' ||
    value === '..'
  )
    throw new Error('Invalid snapshot identity');
}
function integer(value: unknown, minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum)
    throw new Error('Invalid snapshot integer');
}
function json(value: unknown, kind: 'array' | 'object'): unknown {
  text(value);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Invalid snapshot JSON');
  }
  if (
    kind === 'array'
      ? !Array.isArray(parsed)
      : !parsed || typeof parsed !== 'object' || Array.isArray(parsed)
  )
    throw new Error('Invalid snapshot JSON');
  return parsed;
}
export function tokens(value: unknown): Token[] {
  const parsed = json(value, 'array') as unknown[];
  if (parsed.length > MAX_ROWS) throw new Error('Invalid snapshot tokens');
  for (const token of parsed) {
    const row = object(token);
    if (!['text', 'tag', 'locked', 'ws'].includes(String(row.type)))
      throw new Error('Invalid snapshot token');
    text(row.content);
    if (row.meta !== undefined) {
      const meta = object(row.meta);
      if (meta.id !== undefined) text(meta.id);
      if (
        meta.tagType !== undefined &&
        !['paired-start', 'paired-end', 'standalone'].includes(String(meta.tagType))
      )
        throw new Error('Invalid snapshot tag type');
      if (meta.pairedIndex !== undefined) integer(meta.pairedIndex);
      if (
        meta.validationState !== undefined &&
        !['valid', 'error', 'warning'].includes(String(meta.validationState))
      )
        throw new Error('Invalid snapshot token validation');
    }
  }
  return parsed as Token[];
}
function records(input: unknown, keys: string): Row[] {
  if (!Array.isArray(input) || input.length > MAX_ROWS) throw new Error('Invalid snapshot rows');
  return input.map((row) => {
    const value = exact(row, keys.split(','));
    for (const cell of Object.values(value)) {
      if (
        cell !== null &&
        typeof cell !== 'string' &&
        !(typeof cell === 'number' && Number.isFinite(cell))
      )
        throw new Error('Invalid snapshot cell');
    }
    return value as Row;
  });
}
function unique(rows: Row[], field: string, isIdentity = true): Set<string> {
  const seen = new Set<string>();
  for (const row of rows) {
    if (isIdentity) identity(row[field]);
    else text(row[field]);
    if (seen.has(row[field])) throw new Error(`Duplicate snapshot ${field}`);
    seen.add(row[field]);
  }
  return seen;
}
function metadata(row: Row): void {
  for (const key of ['name', 'srcLang', 'tgtLang', 'createdAt', 'updatedAt']) text(row[key], true);
}
function nullableText(value: unknown): void {
  if (value !== null) text(value);
}
function validateTMEntries(input: unknown, tmId: string): CloudTMEntryV2[] {
  const rows = records(input, columns.tm_entries);
  unique(rows, 'id');
  unique(rows, 'srcHash', false);
  for (const row of rows) {
    if (row.tmId !== tmId) throw new Error('Snapshot TM entry ownership mismatch');
    text(row.matchKey);
    text(row.tagsSignature);
    tokens(row.sourceTokensJson);
    tokens(row.targetTokensJson);
    nullableText(row.originSegmentId);
    if (row.originSegmentId !== null) identity(row.originSegmentId);
    text(row.createdAt, true);
    text(row.updatedAt, true);
    integer(row.usageCount);
  }
  return rows as unknown as CloudTMEntryV2[];
}
function validateTM(input: unknown, type: 'main' | 'working'): CloudTMRecordV2 {
  const row = records([input], columns.tms)[0];
  identity(row.id);
  metadata(row);
  if (row.type !== type) throw new Error('Snapshot TM type mismatch');
  return row as unknown as CloudTMRecordV2;
}
export function validateResource(input: unknown): ResourceSnapshotV2 {
  const value = exact(input, ['protocol', 'sourceSQLite', 'kind', 'resource', 'entries']);
  if (
    value.protocol !== 2 ||
    value.sourceSQLite !== 15 ||
    !['tm', 'tb'].includes(String(value.kind))
  )
    throw new Error('Unsupported cloud resource snapshot');
  if (value.kind === 'tm') {
    const resource = validateTM(value.resource, 'main');
    validateTMEntries(value.entries, resource.id);
  } else {
    const row = records([value.resource], columns.term_bases)[0];
    identity(row.id);
    metadata(row);
    const rows = records(value.entries, columns.tb_entries);
    unique(rows, 'id');
    unique(rows, 'srcNorm', false);
    for (const entry of rows) {
      if (entry.tbId !== row.id) throw new Error('Snapshot TB entry ownership mismatch');
      text(entry.srcTerm);
      text(entry.tgtTerm);
      nullableText(entry.note);
      text(entry.createdAt, true);
      text(entry.updatedAt, true);
      integer(entry.usageCount);
    }
  }
  return value as unknown as ResourceSnapshotV2;
}
export function validateProject(input: unknown): ProjectSnapshotV2 {
  const value = exact(input, [
    'protocol',
    'sourceSQLite',
    'kind',
    'project',
    'files',
    'segments',
    'prompts',
    'workingTM',
    'mounts',
  ]);
  if (value.protocol !== 2 || value.sourceSQLite !== 15 || value.kind !== 'project')
    throw new Error('Unsupported cloud project snapshot');
  const project = records([value.project], columns.projects)[0];
  identity(project.uuid);
  metadata(project);
  if (!['translation', 'custom', 'review'].includes(String(project.projectType)))
    throw new Error('Invalid snapshot project type');
  nullableText(project.aiPrompt);
  if (
    project.aiTemperature !== null &&
    (typeof project.aiTemperature !== 'number' || !Number.isFinite(project.aiTemperature))
  )
    throw new Error('Invalid snapshot temperature');
  text(project.aiModel);
  json(project.qaSettingsJson, 'object');
  const files = records(value.files, columns.files);
  const fileUUIDs = unique(files, 'uuid');
  for (const file of files) {
    text(file.name, true);
    if (
      file.name === '.' ||
      file.name === '..' ||
      /[<>:"/\\|?*]/u.test(file.name) ||
      Array.from(file.name).some((character) => character.charCodeAt(0) < 32)
    )
      throw new Error('Unsafe project filename');
    integer(file.totalSegments);
    integer(file.confirmedSegments);
    if (Number(file.confirmedSegments) > Number(file.totalSegments))
      throw new Error('Invalid file statistics');
    if (file.importOptionsJson !== null) json(file.importOptionsJson, 'object');
    text(file.createdAt, true);
    text(file.updatedAt, true);
  }
  const segments = records(value.segments, `${columns.segments},fileUUID`);
  unique(segments, 'segmentId');
  for (const segment of segments) {
    if (typeof segment.fileUUID !== 'string' || !fileUUIDs.has(segment.fileUUID))
      throw new Error('Snapshot segment file missing');
    integer(segment.orderIndex);
    tokens(segment.sourceTokensJson);
    tokens(segment.targetTokensJson);
    if (
      !['empty', 'draft', 'confirmed', 'untranslated', 'translated'].includes(
        String(segment.status),
      )
    )
      throw new Error('Invalid snapshot segment status');
    text(segment.tagsSignature);
    text(segment.matchKey);
    text(segment.srcHash);
    json(segment.metaJson, 'object');
    if (segment.qaIssuesJson !== null && segment.qaIssuesJson !== '')
      json(segment.qaIssuesJson, 'array');
    text(segment.updatedAt, true);
  }
  const prompts = records(value.prompts, columns.project_prompts);
  unique(
    prompts.map((row) => ({ ...row, name: String(row.name).toLocaleLowerCase() })),
    'name',
    false,
  );
  for (const prompt of prompts) {
    text(prompt.name, true);
    text(prompt.content);
    text(prompt.createdAt, true);
    text(prompt.updatedAt, true);
  }
  const mounts = exact(value.mounts, ['tms', 'tbs']);
  const tms = records(mounts.tms, columns.project_tms);
  const tbs = records(mounts.tbs, columns.project_term_bases);
  const tmIds = unique(tms, 'tmId');
  unique(tbs, 'tbId');
  for (const mount of [...tms, ...tbs]) {
    integer(mount.priority, Number.MIN_SAFE_INTEGER);
    if (mount.isEnabled !== 0 && mount.isEnabled !== 1)
      throw new Error('Invalid snapshot mount state');
  }
  for (const mount of tms) {
    if (!['read', 'write', 'readwrite'].includes(String(mount.permission)))
      throw new Error('Invalid snapshot TM permission');
  }
  if (value.workingTM !== null) {
    const working = exact(value.workingTM, ['resource', 'entries']);
    const resource = validateTM(working.resource, 'working');
    if (!tmIds.has(resource.id)) throw new Error('Working TM mount missing');
    // Origins are provenance, not a foreign key: file removal may leave valid
    // Working TM entries whose originating segment no longer exists.
    validateTMEntries(working.entries, resource.id);
  }
  return value as unknown as ProjectSnapshotV2;
}

export function snapshotProjectUUID(input: unknown): string {
  return validateProject(input).project.uuid;
}
