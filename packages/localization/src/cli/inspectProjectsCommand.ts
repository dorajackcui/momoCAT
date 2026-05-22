import { CATDatabase } from '@cat/db';
import type { Segment } from '@cat/core/models';
import type { Project } from '@cat/core/project';

const CONNECTION_CATALOG_KEY = 'ai_connection_catalog_v1';
const PROVIDER_CATALOG_KEY = 'ai_provider_catalog_v2';
const CONNECTION_KEY_PREFIX = 'ai_connection_key::';
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
  kind: 'configured';
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

interface StoredAIConnection {
  id: string;
  name: string;
  baseUrl: string;
  protocol: 'chat-completions';
  kind: 'openai-compatible';
  discoveredModels: string[];
}

interface StoredAIProvider {
  id: string;
  name: string;
  connectionId: string;
  model: string;
  protocol: 'chat-completions';
  kind: 'configured';
}

export function runInspectProjectsCommand(
  config: InspectProjectsCommandConfig,
): InspectProjectsResult {
  const db = new CATDatabase(config.dbPath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const settings = readSettings(db);
    const providers = readConfiguredProviders(settings);
    const providerById = new Map(providers.map((provider) => [provider.id, provider]));
    const projects = readProjects(db, config.projectId).map((project) =>
      inspectProject(db, project, providers, providerById),
    );

    return {
      dbPath: config.dbPath,
      generatedAt: config.generatedAt
        ? config.generatedAt()
        : new Date().toISOString(),
      providers,
      projects,
    };
  } finally {
    db.close();
  }
}

function readSettings(db: CATDatabase): Map<string, string> {
  const settings = new Map<string, string>();
  for (const key of [CONNECTION_CATALOG_KEY, PROVIDER_CATALOG_KEY]) {
    const value = db.getSetting(key);
    if (value !== undefined) {
      settings.set(key, value);
    }
  }

  const rawCatalog = settings.get(CONNECTION_CATALOG_KEY);
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

  for (const connection of parsed) {
    if (isStoredAIConnection(connection)) {
      const key = buildConnectionKey(connection.id);
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
  providers: InspectProviderSummary[],
  providerById: Map<string, InspectProviderSummary>,
): InspectProjectSummary {
  return {
    id: project.id,
    name: project.name,
    srcLang: project.srcLang,
    tgtLang: project.tgtLang,
    projectType: project.projectType,
    promptChars: project.aiPrompt ? project.aiPrompt.length : 0,
    model: resolveProjectModel(project.aiModel, providers, providerById),
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

function readConfiguredProviders(settings: Map<string, string>): InspectProviderSummary[] {
  const connections = readConnections(settings);
  const providers = readProviders(settings);

  return providers.flatMap((provider) => {
    const connection = connections.get(provider.connectionId);
    if (!connection) {
      return [];
    }
    const apiKey = settings.get(buildConnectionKey(connection.id)) ?? '';
    return [
      {
        id: provider.id,
        name: provider.name,
        baseUrl: normalizeBaseUrl(connection.baseUrl),
        model: provider.model,
        kind: 'configured' as const,
        apiKeySet: Boolean(apiKey),
        apiKeyLast4: apiKey ? apiKey.slice(-4) : null,
      },
    ];
  });
}

function readConnections(settings: Map<string, string>): Map<string, StoredAIConnection> {
  const raw = settings.get(CONNECTION_CATALOG_KEY);
  if (!raw) {
    return new Map();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Map();
  }

  if (!Array.isArray(parsed)) {
    return new Map();
  }

  return new Map(
    parsed
      .filter(isStoredAIConnection)
      .map((connection) => [
        connection.id,
        {
          ...connection,
          name: connection.name.trim(),
          baseUrl: normalizeBaseUrl(connection.baseUrl),
          discoveredModels: connection.discoveredModels.filter(
            (model): model is string => typeof model === 'string' && model.trim().length > 0,
          ),
        },
      ]),
  );
}

function readProviders(settings: Map<string, string>): StoredAIProvider[] {
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

  return parsed.filter(isStoredAIProvider).map((provider) => ({
    id: provider.id.trim(),
    name: provider.name.trim(),
    connectionId: provider.connectionId.trim(),
    model: provider.model.trim(),
    protocol: 'chat-completions',
    kind: 'configured',
  }));
}

function isStoredAIConnection(value: unknown): value is StoredAIConnection {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<StoredAIConnection>;
  return (
    candidate.kind === 'openai-compatible' &&
    candidate.protocol === 'chat-completions' &&
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.baseUrl === 'string' &&
    Array.isArray(candidate.discoveredModels)
  );
}

function isStoredAIProvider(value: unknown): value is StoredAIProvider {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<StoredAIProvider>;
  return (
    candidate.kind === 'configured' &&
    candidate.protocol === 'chat-completions' &&
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.connectionId === 'string' &&
    typeof candidate.model === 'string'
  );
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function buildConnectionKey(connectionId: string): string {
  return `${CONNECTION_KEY_PREFIX}${connectionId}`;
}

function resolveProjectModel(
  rawModel: string | null | undefined,
  providers: InspectProviderSummary[],
  providerById: Map<string, InspectProviderSummary>,
): InspectProviderSummary {
  const configuredId =
    typeof rawModel === 'string' && rawModel.trim() ? rawModel.trim() : null;
  const provider = configuredId ? providerById.get(configuredId) : undefined;
  if (provider) {
    return {
      ...provider,
      configuredId,
      fallbackFrom: null,
    };
  }

  const fallback = providers[0];
  if (fallback) {
    return {
      ...fallback,
      configuredId,
      fallbackFrom: configuredId,
      resolvedId: fallback.id,
    };
  }

  return {
    id: configuredId ?? '',
    configuredId,
    name: 'No configured AI provider',
    baseUrl: null,
    model: null,
    kind: 'configured',
    apiKeySet: false,
    apiKeyLast4: null,
    fallbackFrom: configuredId,
  };
}
