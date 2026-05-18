#!/usr/bin/env node

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

const PROVIDER_CATALOG_KEY = "ai_provider_catalog_v1";
const PROVIDER_KEY_PREFIX = "ai_provider_key::";
const OPENAI_API_KEY = "openai_api_key";
const BUILTIN_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_PROJECT_AI_MODEL = "builtin:openai:gpt-5.4-mini";
const BUILTIN_OPENAI_PROVIDER_MODELS = {
  "builtin:openai:gpt-5.4": "gpt-5.4",
  "builtin:openai:gpt-5.4-mini": "gpt-5.4-mini",
  "builtin:openai:gpt-5": "gpt-5",
  "builtin:openai:gpt-5-mini": "gpt-5-mini",
};
const LEGACY_MODEL_TO_PROVIDER_ID = {
  "gpt-5.4": "builtin:openai:gpt-5.4",
  "gpt-5.4-mini": "builtin:openai:gpt-5.4-mini",
  "gpt-5": "builtin:openai:gpt-5",
  "gpt-5-mini": "builtin:openai:gpt-5-mini",
};

function usage() {
  console.log(`Usage:
  node scripts/inspect-projects.mjs [options]

Options:
  --db <path>             SQLite DB path. Default: .cat_data/cat_v1.db
  --project-id <id>       Optional project id filter.
  --json                  Print machine-readable JSON.
  -h, --help              Show this help.

Examples:
  npm run inspect:projects -- --db .cat_data/cat_v1.db
  npm run inspect:projects -- --db .cat_data/cat_v1.db --project-id 3
  npm run inspect:projects -- --db .cat_data/cat_v1.db --json`);
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function parseArgs(argv) {
  const config = {
    dbPath: path.resolve(process.cwd(), ".cat_data/cat_v1.db"),
    projectId: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    if (arg === "--db" || arg === "--db-path") {
      config.dbPath = path.resolve(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--db=")) {
      config.dbPath = path.resolve(arg.slice("--db=".length));
      continue;
    }
    if (arg === "--project-id") {
      config.projectId = parsePositiveInteger(
        readValue(argv, index, arg),
        "--project-id",
      );
      index += 1;
      continue;
    }
    if (arg.startsWith("--project-id=")) {
      config.projectId = parsePositiveInteger(
        arg.slice("--project-id=".length),
        "--project-id",
      );
      continue;
    }
    if (arg === "--json") {
      config.json = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!fs.existsSync(config.dbPath)) {
    throw new Error(`Database not found: ${config.dbPath}`);
  }

  return config;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function inspectProjects({ dbPath, projectId = null }) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const settings = readSettings(db);
    const customProviders = readCustomProviders(settings);
    const customProviderById = new Map(
      customProviders.map((provider) => [provider.id, provider]),
    );
    const projects = readProjects(db, projectId).map((project) =>
      inspectProject(db, project, settings, customProviderById),
    );

    return {
      dbPath,
      generatedAt: new Date().toISOString(),
      providers: customProviders,
      projects,
    };
  } finally {
    db.close();
  }
}

function readSettings(db) {
  if (!tableExists(db, "app_settings")) {
    return new Map();
  }

  const rows = db.prepare("select key, value from app_settings").all();
  return new Map(rows.map((row) => [row.key, row.value]));
}

function tableExists(db, tableName) {
  const row = db
    .prepare("select name from sqlite_master where type = 'table' and name = ?")
    .get(tableName);
  return Boolean(row);
}

function readCustomProviders(settings) {
  const raw = settings.get(PROVIDER_CATALOG_KEY);
  if (!raw) {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(isStoredCustomProvider).map((provider) => {
    const apiKey = settings.get(buildProviderKey(provider.id)) ?? "";
    return {
      id: provider.id,
      name: provider.name,
      baseUrl: normalizeBaseUrl(provider.baseUrl),
      model: provider.model,
      kind: "custom",
      apiKeySet: Boolean(apiKey),
      apiKeyLast4: apiKey ? apiKey.slice(-4) : null,
    };
  });
}

function isStoredCustomProvider(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (
    value.kind === "custom" &&
    value.protocol === "chat-completions" &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.baseUrl === "string" &&
    typeof value.model === "string"
  );
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.trim().replace(/\/+$/, "");
}

function buildProviderKey(providerId) {
  return `${PROVIDER_KEY_PREFIX}${providerId}`;
}

function readProjects(db, projectId) {
  const baseSql = `
    select id, name, srcLang, tgtLang, projectType, aiPrompt, aiModel
    from projects
  `;
  if (projectId) {
    return db
      .prepare(`${baseSql} where id = ? order by id desc`)
      .all(projectId);
  }
  return db.prepare(`${baseSql} order by id desc`).all();
}

function inspectProject(db, project, settings, customProviderById) {
  return {
    id: project.id,
    name: project.name,
    srcLang: project.srcLang,
    tgtLang: project.tgtLang,
    projectType: project.projectType,
    promptChars: project.aiPrompt ? project.aiPrompt.length : 0,
    model: resolveProjectModel(project.aiModel, settings, customProviderById),
    mountedTMs: readMountedTMs(db, project.id),
    mountedTBs: readMountedTBs(db, project.id),
    files: readFiles(db, project.id),
  };
}

function resolveProjectModel(rawModel, settings, customProviderById) {
  const configuredId =
    typeof rawModel === "string" && rawModel.trim() ? rawModel.trim() : null;
  const normalizedId = normalizeProjectAIModel(configuredId);
  const customProvider = customProviderById.get(normalizedId);
  if (customProvider) {
    return {
      ...customProvider,
      configuredId,
      fallbackFrom: null,
    };
  }

  if (normalizedId.startsWith("custom:")) {
    const apiKey = settings.get(buildProviderKey(normalizedId)) ?? "";
    return {
      id: normalizedId,
      configuredId,
      name: "Unknown custom provider",
      baseUrl: null,
      model: null,
      kind: "custom",
      apiKeySet: Boolean(apiKey),
      apiKeyLast4: apiKey ? apiKey.slice(-4) : null,
      fallbackFrom: normalizedId,
      resolvedId: DEFAULT_PROJECT_AI_MODEL,
    };
  }

  const providerId = isBuiltinProviderId(normalizedId)
    ? normalizedId
    : DEFAULT_PROJECT_AI_MODEL;
  const builtinProvider = buildBuiltinProvider(
    providerId,
    settings.get(OPENAI_API_KEY) ?? "",
  );
  return {
    ...builtinProvider,
    configuredId,
    fallbackFrom: providerId === normalizedId ? null : normalizedId,
  };
}

function normalizeProjectAIModel(value) {
  if (!value || typeof value !== "string" || !value.trim()) {
    return DEFAULT_PROJECT_AI_MODEL;
  }
  const trimmed = value.trim();
  return LEGACY_MODEL_TO_PROVIDER_ID[trimmed] ?? trimmed;
}

function isBuiltinProviderId(providerId) {
  return Object.hasOwn(BUILTIN_OPENAI_PROVIDER_MODELS, providerId);
}

function buildBuiltinProvider(providerId, apiKey) {
  const model =
    BUILTIN_OPENAI_PROVIDER_MODELS[providerId] ??
    BUILTIN_OPENAI_PROVIDER_MODELS[DEFAULT_PROJECT_AI_MODEL];
  return {
    id: providerId,
    name: `OpenAI / ${model}`,
    baseUrl: BUILTIN_OPENAI_BASE_URL,
    model,
    kind: "builtin",
    apiKeySet: Boolean(apiKey),
    apiKeyLast4: apiKey ? apiKey.slice(-4) : null,
  };
}

function readMountedTMs(db, projectId) {
  if (!tableExists(db, "project_tms") || !tableExists(db, "tms")) {
    return [];
  }

  return db
    .prepare(
      `
        select t.id, t.name, t.srcLang, t.tgtLang, t.type, pt.priority, pt.permission, pt.isEnabled
        from project_tms pt
        join tms t on t.id = pt.tmId
        where pt.projectId = ?
        order by pt.priority asc, t.name asc
      `,
    )
    .all(projectId)
    .map((row) => ({
      id: row.id,
      name: row.name,
      srcLang: row.srcLang,
      tgtLang: row.tgtLang,
      type: row.type,
      priority: row.priority,
      permission: row.permission,
      isEnabled: Boolean(row.isEnabled),
    }));
}

function readMountedTBs(db, projectId) {
  if (
    !tableExists(db, "project_term_bases") ||
    !tableExists(db, "term_bases")
  ) {
    return [];
  }

  return db
    .prepare(
      `
        select tb.id, tb.name, tb.srcLang, tb.tgtLang, ptb.priority, ptb.isEnabled
        from project_term_bases ptb
        join term_bases tb on tb.id = ptb.tbId
        where ptb.projectId = ?
        order by ptb.priority asc, tb.name asc
      `,
    )
    .all(projectId)
    .map((row) => ({
      id: row.id,
      name: row.name,
      srcLang: row.srcLang,
      tgtLang: row.tgtLang,
      priority: row.priority,
      isEnabled: Boolean(row.isEnabled),
    }));
}

function readFiles(db, projectId) {
  if (!tableExists(db, "files")) {
    return [];
  }

  return db
    .prepare(
      `
        select id, name, totalSegments, confirmedSegments
        from files
        where projectId = ?
        order by id desc
      `,
    )
    .all(projectId)
    .map((file) => ({
      id: file.id,
      name: file.name,
      totalSegments: file.totalSegments,
      confirmedSegments: file.confirmedSegments,
      targetRows: countTargetRows(db, file.id),
      statusCounts: readStatusCounts(db, file.id),
    }));
}

function countTargetRows(db, fileId) {
  if (!tableExists(db, "segments")) {
    return 0;
  }
  const row = db
    .prepare(
      `
        select count(*) as count
        from segments
        where fileId = ?
          and length(trim(coalesce(targetTokensJson, ''))) > 2
      `,
    )
    .get(fileId);
  return row.count;
}

function readStatusCounts(db, fileId) {
  if (!tableExists(db, "segments")) {
    return {};
  }
  const rows = db
    .prepare(
      `
        select coalesce(status, 'unknown') as status, count(*) as count
        from segments
        where fileId = ?
        group by coalesce(status, 'unknown')
        order by status asc
      `,
    )
    .all(fileId);
  return Object.fromEntries(rows.map((row) => [row.status, row.count]));
}

function formatInspection(summary) {
  const lines = [];
  lines.push(`Database: ${summary.dbPath}`);
  lines.push(`Projects: ${summary.projects.length}`);
  lines.push("");
  lines.push("API providers:");
  if (summary.providers.length === 0) {
    lines.push("  - no custom providers configured");
  } else {
    for (const provider of summary.providers) {
      lines.push(
        `  - ${provider.id} (${provider.name} / ${provider.model}) apiKey: ${formatKeyStatus(provider)} baseUrl: ${
          provider.baseUrl
        }`,
      );
    }
  }

  if (summary.projects.length === 0) {
    lines.push("");
    lines.push("No projects found.");
    return `${lines.join("\n")}\n`;
  }

  for (const project of summary.projects) {
    lines.push("");
    lines.push(
      `Project ${project.id}: ${project.name} [${project.srcLang} -> ${project.tgtLang}]`,
    );
    lines.push(`  type: ${project.projectType}`);
    lines.push(`  model: ${formatProjectModel(project.model)}`);
    lines.push(`  prompt: ${project.promptChars} chars`);
    lines.push(`  mounted TM: ${project.mountedTMs.length}`);
    for (const tm of project.mountedTMs) {
      lines.push(
        `    - ${tm.name} [${tm.srcLang} -> ${tm.tgtLang}] type=${tm.type} priority=${tm.priority} permission=${tm.permission} enabled=${tm.isEnabled}`,
      );
    }
    lines.push(`  mounted TB: ${project.mountedTBs.length}`);
    for (const tb of project.mountedTBs) {
      lines.push(
        `    - ${tb.name} [${tb.srcLang} -> ${tb.tgtLang}] priority=${tb.priority} enabled=${tb.isEnabled}`,
      );
    }
    lines.push("  files:");
    if (project.files.length === 0) {
      lines.push("    - none");
    } else {
      for (const file of project.files) {
        lines.push(
          `    - file ${file.id}: ${file.name}, total=${file.totalSegments}, targetRows=${file.targetRows}, confirmed=${file.confirmedSegments}, status=${formatStatusCounts(
            file.statusCounts,
          )}`,
        );
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatKeyStatus(provider) {
  return provider.apiKeySet
    ? `set${provider.apiKeyLast4 ? ` last4=${provider.apiKeyLast4}` : ""}`
    : "missing";
}

function formatProjectModel(model) {
  const providerLabel = model.model
    ? `${model.id} (${model.name} / ${model.model})`
    : `${model.id} (${model.name})`;
  const fallbackLabel = model.fallbackFrom
    ? ` fallbackFrom=${model.fallbackFrom}`
    : "";
  return `${providerLabel}, apiKey: ${formatKeyStatus(model)}${fallbackLabel}`;
}

function formatStatusCounts(statusCounts) {
  const entries = Object.entries(statusCounts);
  if (entries.length === 0) {
    return "none";
  }
  return entries.map(([status, count]) => `${status}:${count}`).join(", ");
}

function main() {
  try {
    const config = parseArgs(process.argv.slice(2));
    const summary = inspectProjects(config);
    if (config.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      process.stdout.write(formatInspection(summary));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main();
}

export { formatInspection, inspectProjects, parseArgs };
