import { CATDatabase } from '@cat/db';
import type { Segment } from '@cat/core/models';
import {
  BUILTIN_OPENAI_PROVIDER_MODELS,
  DEFAULT_PROJECT_AI_MODEL,
  normalizeProjectAIModel,
  type Project,
} from '@cat/core/project';

const PROVIDER_CATALOG_KEY = 'ai_provider_catalog_v1';
const PROVIDER_KEY_PREFIX = 'ai_provider_key::';
const OPENAI_API_KEY = 'openai_api_key';
const BUILTIN_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const SEGMENT_PAGE_SIZE = 500;

export interface InspectProjectsCommandConfig {
  dbPath: string;
  projectId?: number;
  generatedAt?: () => string;
}

export interface InspectProviderSummary {
  id: string;
  name: string;
  baseUrl: string | null;
  model: string | null;
  kind: 'builtin' | 'custom';
  apiKeySet: boolean;
  apiKeyLast4: string | null;
  configuredId?: string | null;
  fallbackFrom?: string | null;
  resolvedId?: string;
}

export interface InspectMountedTMSummary {
  id: string;
  name: string;
  srcLang: string;
  tgtLang: string;
  type: string;
  priority: number;
  permission: string;
  isEnabled: boolean;
}

export interface InspectMountedTBSummary {
  id: string;
  name: string;
  srcLang: string;
  tgtLang: string;
  priority: number;
  isEnabled: boolean;
}

export interface InspectProjectFileSummary {
  id: number;
  name: string;
  totalSegments: number;
  targetRows: number;
  confirmedSegments: number;
  statusCounts: Record<string, number>;
}

export interface InspectProjectSummary {
  id: number;
  name: string;
  srcLang: string;
  tgtLang: string;
  projectType: string | undefined;
  promptChars: number;
  model: InspectProviderSummary;
  mountedTMs: InspectMountedTMSummary[];
  mountedTBs: InspectMountedTBSummary[];
  files: InspectProjectFileSummary[];
}

export interface InspectProjectsResult {
  dbPath: string;
  generatedAt: string;
  providers: InspectProviderSummary[];
  projects: InspectProjectSummary[];
}

interface StoredCustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  protocol: 'chat-completions';
  kind: 'custom';
}

export function runInspectProjectsCommand(
  config: InspectProjectsCommandConfig,
): InspectProjectsResult {
  const db = new CATDatabase(config.dbPath);
  try {
    const settings = readSettings(db);
    const customProviders = readCustomProviders(settings);
    const customProviderById = new Map(
      customProviders.map((provider) => [provider.id, provider]),
    );
    const projects = readProjects(db, config.projectId).map((project) =>
      inspectProject(db, project, settings, customProviderById),
    );

    return {
      dbPath: config.dbPath,
      generatedAt: config.generatedAt
        ? config.generatedAt()
        : new Date().toISOString(),
      providers: customProviders,
      projects,
    };
  } finally {
    db.close();
  }
}

function readSettings(db: CATDatabase): Map<string, string> {
  const settings = new Map<string, string>();
  for (const key of [PROVIDER_CATALOG_KEY, OPENAI_API_KEY]) {
    const value = db.getSetting(key);
    if (value !== undefined) {
      settings.set(key, value);
    }
  }

  const rawCatalog = settings.get(PROVIDER_CATALOG_KEY);
  if (!rawCatalog) {
    return settings;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawCatalog);
  } catch {
    return settings;
  }

  if (!Array.isArray(parsed)) {
    return settings;
  }

  for (const provider of parsed) {
    if (isStoredCustomProvider(provider)) {
      const key = buildProviderKey(provider.id);
      const value = db.getSetting(key);
      if (value !== undefined) {
        settings.set(key, value);
      }
    }
  }

  return settings;
}

function readProjects(db: CATDatabase, projectId: number | undefined): Project[] {
  if (projectId !== undefined) {
    const project = db.getProject(projectId);
    return project ? [project] : [];
  }
  return db.listProjects();
}

function inspectProject(
  db: CATDatabase,
  project: Project,
  settings: Map<string, string>,
  customProviderById: Map<string, InspectProviderSummary>,
): InspectProjectSummary {
  return {
    id: project.id,
    name: project.name,
    srcLang: project.srcLang,
    tgtLang: project.tgtLang,
    projectType: project.projectType,
    promptChars: project.aiPrompt ? project.aiPrompt.length : 0,
    model: resolveProjectModel(db, project.aiModel, settings, customProviderById),
    mountedTMs: db.getProjectMountedTMs(project.id).map((tm) => ({
      id: tm.id,
      name: tm.name,
      srcLang: tm.srcLang,
      tgtLang: tm.tgtLang,
      type: tm.type,
      priority: tm.priority,
      permission: tm.permission,
      isEnabled: Boolean(tm.isEnabled),
    })),
    mountedTBs: db.getProjectMountedTermBases(project.id).map((tb) => ({
      id: tb.id,
      name: tb.name,
      srcLang: tb.srcLang,
      tgtLang: tb.tgtLang,
      priority: tb.priority,
      isEnabled: Boolean(tb.isEnabled),
    })),
    files: db.listFiles(project.id).map((file) => inspectFile(db, file)),
  };
}

function inspectFile(
  db: CATDatabase,
  file: ReturnType<CATDatabase['listFiles']>[number],
): InspectProjectFileSummary {
  const segmentSummary = summarizeFileSegments(db, file.id);
  return {
    id: file.id,
    name: file.name,
    totalSegments: file.totalSegments,
    targetRows: segmentSummary.targetRows,
    confirmedSegments: file.confirmedSegments,
    statusCounts: segmentSummary.statusCounts,
  };
}

function summarizeFileSegments(
  db: CATDatabase,
  fileId: number,
): { targetRows: number; statusCounts: Record<string, number> } {
  let targetRows = 0;
  const statusCounts: Record<string, number> = {};

  for (let offset = 0; ; offset += SEGMENT_PAGE_SIZE) {
    const segments = db.getSegmentsPage(fileId, offset, SEGMENT_PAGE_SIZE);
    if (segments.length === 0) {
      break;
    }
    for (const segment of segments) {
      if (hasTargetTokens(segment)) {
        targetRows += 1;
      }
      statusCounts[segment.status] = (statusCounts[segment.status] ?? 0) + 1;
    }
  }

  return { targetRows, statusCounts };
}

function hasTargetTokens(segment: Segment): boolean {
  return segment.targetTokens.length > 0;
}

function readCustomProviders(settings: Map<string, string>): InspectProviderSummary[] {
  const raw = settings.get(PROVIDER_CATALOG_KEY);
  if (!raw) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(isStoredCustomProvider).map((provider) => {
    const apiKey = settings.get(buildProviderKey(provider.id)) ?? '';
    return {
      id: provider.id,
      name: provider.name,
      baseUrl: normalizeBaseUrl(provider.baseUrl),
      model: provider.model,
      kind: 'custom',
      apiKeySet: Boolean(apiKey),
      apiKeyLast4: apiKey ? apiKey.slice(-4) : null,
    };
  });
}

function isStoredCustomProvider(value: unknown): value is StoredCustomProvider {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<StoredCustomProvider>;
  return (
    candidate.kind === 'custom' &&
    candidate.protocol === 'chat-completions' &&
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.baseUrl === 'string' &&
    typeof candidate.model === 'string'
  );
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function buildProviderKey(providerId: string): string {
  return `${PROVIDER_KEY_PREFIX}${providerId}`;
}

function resolveProjectModel(
  db: CATDatabase,
  rawModel: string | null | undefined,
  settings: Map<string, string>,
  customProviderById: Map<string, InspectProviderSummary>,
): InspectProviderSummary {
  const configuredId =
    typeof rawModel === 'string' && rawModel.trim() ? rawModel.trim() : null;
  const normalizedId = normalizeProjectAIModel(configuredId);
  const customProvider = customProviderById.get(normalizedId);
  if (customProvider) {
    return {
      ...customProvider,
      configuredId,
      fallbackFrom: null,
    };
  }

  if (normalizedId.startsWith('custom:')) {
    const apiKey =
      settings.get(buildProviderKey(normalizedId)) ??
      db.getSetting(buildProviderKey(normalizedId)) ??
      '';
    return {
      id: normalizedId,
      configuredId,
      name: 'Unknown custom provider',
      baseUrl: null,
      model: null,
      kind: 'custom',
      apiKeySet: Boolean(apiKey),
      apiKeyLast4: apiKey ? apiKey.slice(-4) : null,
      fallbackFrom: normalizedId,
      resolvedId: DEFAULT_PROJECT_AI_MODEL,
    };
  }

  const providerId = Object.hasOwn(BUILTIN_OPENAI_PROVIDER_MODELS, normalizedId)
    ? normalizedId
    : DEFAULT_PROJECT_AI_MODEL;
  const model =
    BUILTIN_OPENAI_PROVIDER_MODELS[
      providerId as keyof typeof BUILTIN_OPENAI_PROVIDER_MODELS
    ] ?? BUILTIN_OPENAI_PROVIDER_MODELS[
      DEFAULT_PROJECT_AI_MODEL as keyof typeof BUILTIN_OPENAI_PROVIDER_MODELS
    ];
  const apiKey = settings.get(OPENAI_API_KEY) ?? '';

  return {
    id: providerId,
    configuredId,
    name: `OpenAI / ${model}`,
    baseUrl: BUILTIN_OPENAI_BASE_URL,
    model,
    kind: 'builtin',
    apiKeySet: Boolean(apiKey),
    apiKeyLast4: apiKey ? apiKey.slice(-4) : null,
    fallbackFrom: providerId === normalizedId ? null : normalizedId,
  };
}
