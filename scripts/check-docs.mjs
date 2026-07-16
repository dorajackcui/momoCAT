import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const DOCS_DIR = path.join(ROOT, "DOCS");

const allowedDocs = new Set([
  "DOCS/README.md",
  "DOCS/ARCHITECTURE.md",
  "DOCS/DEVELOPMENT.md",
  "DOCS/DATA_MODEL.md",
  "DOCS/CLI.md",
  "DOCS/LOCALIZATION.md",
]);

const entrypoints = [
  "AGENTS.md",
  "README.md",
  "apps/cli/README.md",
  ...allowedDocs,
];
const retiredPaths = [
  "DOCS/archive",
  "DOCS/superpowers",
  "DOCS/specs",
  "DOCS/plans",
];
const retiredReferences = [
  /DOCS\/(?:00_START_HERE|10_ARCHITECTURE|20_ENGINEERING_RUNBOOK|30_DATA_MODEL|40_CLI_OPERATION|50_MT_REQUEST_MODEL|60_TM_TB_REFERENCE|90_STATUS_AND_ROADMAP|99_HISTORY)\.md/u,
  /DOCS\/(?:archive|superpowers|specs|plans)(?:\/|\b)/u,
];
const forbiddenGeneratedPaths = ["DOCS/node_modules"];

const errors = [];
let checkedLinks = 0;

function relative(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function listMarkdownFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.isSymbolicLink()) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listMarkdownFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(fullPath);
  }
  return files;
}

function lineNumber(text, offset) {
  return text.slice(0, offset).split(/\r?\n/u).length;
}

function checkDocSet() {
  const actual = new Set(listMarkdownFiles(DOCS_DIR).map(relative));
  for (const expected of allowedDocs) {
    if (!actual.has(expected))
      errors.push(`Missing active document: ${expected}`);
  }
  for (const file of actual) {
    if (!allowedDocs.has(file)) {
      errors.push(
        `Unexpected Markdown under DOCS/: ${file}. Extend the owned doc set deliberately.`,
      );
    }
  }
  for (const retiredPath of retiredPaths) {
    if (fs.existsSync(path.join(ROOT, retiredPath))) {
      errors.push(`Retired documentation path must not exist: ${retiredPath}`);
    }
  }
  for (const generatedPath of forbiddenGeneratedPaths) {
    if (fs.existsSync(path.join(ROOT, generatedPath))) {
      errors.push(
        `Generated dependency/output path must not exist: ${generatedPath}`,
      );
    }
  }
}

function checkMarkdownLinks(filePath, text) {
  const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/gu;
  for (const match of text.matchAll(linkPattern)) {
    let destination = match[1].trim();
    if (destination.startsWith("<") && destination.endsWith(">")) {
      destination = destination.slice(1, -1);
    }
    destination = destination.split(/\s+["']/u, 1)[0];
    if (
      destination === "" ||
      destination.startsWith("#") ||
      /^[a-z][a-z\d+.-]*:/iu.test(destination)
    ) {
      continue;
    }

    const cleanDestination = destination.split("#", 1)[0].split("?", 1)[0];
    const resolved = path.resolve(
      path.dirname(filePath),
      decodeURIComponent(cleanDestination),
    );
    checkedLinks += 1;
    if (!fs.existsSync(resolved)) {
      errors.push(
        `${relative(filePath)}:${lineNumber(text, match.index)} links to missing ${destination}`,
      );
    }
  }
}

function isEscaped(text, index) {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && text[cursor] === "\\";
    cursor -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

export function splitMarkdownTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;

  const cells = [];
  let cell = "";
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character === "|" && !isEscaped(trimmed, index)) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());

  if (trimmed.startsWith("|")) cells.shift();
  if (trimmed.endsWith("|") && !isEscaped(trimmed, trimmed.length - 1))
    cells.pop();
  return cells;
}

function isTableDelimiterRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

export function findMarkdownTableErrors(text) {
  const lines = text.split(/\r?\n/u);
  const tableErrors = [];
  let inFence = false;

  for (let index = 0; index < lines.length - 1; index += 1) {
    if (/^\s*(?:```|~~~)/u.test(lines[index])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const header = splitMarkdownTableRow(lines[index]);
    const delimiter = splitMarkdownTableRow(lines[index + 1]);
    if (!header || !delimiter || !isTableDelimiterRow(delimiter)) continue;

    const expectedColumns = header.length;
    if (delimiter.length !== expectedColumns) {
      tableErrors.push({
        line: index + 2,
        message: `table delimiter has ${delimiter.length} columns; header has ${expectedColumns}`,
      });
    }

    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const rowLine = lines[rowIndex];
      if (rowLine.trim() === "" || /^\s*(?:```|~~~)/u.test(rowLine)) break;
      const row = splitMarkdownTableRow(rowLine);
      if (!row || row.length < 2) break;
      if (row.length !== expectedColumns) {
        tableErrors.push({
          line: rowIndex + 1,
          message: `table row has ${row.length} columns; header has ${expectedColumns}`,
        });
      }
    }
  }

  return tableErrors;
}

function checkMarkdownTables(filePath, text) {
  for (const tableError of findMarkdownTableErrors(text)) {
    errors.push(
      `${relative(filePath)}:${tableError.line} ${tableError.message}`,
    );
  }
}

function collectPackageScripts() {
  const manifests = [
    { workspace: "root", manifest: "package.json" },
    { workspace: "apps/cli", manifest: "apps/cli/package.json" },
    { workspace: "apps/desktop", manifest: "apps/desktop/package.json" },
    { workspace: "packages/core", manifest: "packages/core/package.json" },
    { workspace: "packages/db", manifest: "packages/db/package.json" },
    {
      workspace: "packages/localization",
      manifest: "packages/localization/package.json",
    },
  ];
  const scripts = new Map();
  for (const { workspace, manifest } of manifests) {
    const parsed = JSON.parse(read(path.join(ROOT, manifest)));
    const record = {
      workspace,
      scripts: new Set(Object.keys(parsed.scripts ?? {})),
    };
    scripts.set(workspace, record);
    if (typeof parsed.name === "string") scripts.set(parsed.name, record);
  }
  return scripts;
}

export function findNpmRunCommands(text) {
  const commands = [];
  const commandPattern =
    /\bnpm(?:\s+--[a-z][a-z-]*)*\s+run\s+([a-z\d][a-z\d:_-]*)([^\r\n]*)/giu;
  for (const match of text.matchAll(commandPattern)) {
    const workspaceMatch = match[2].match(/--workspace(?:=|\s+)([^\s`|]+)/u);
    commands.push({
      script: match[1],
      workspace: workspaceMatch?.[1],
      index: match.index,
    });
  }
  return commands;
}

function checkScriptReferences(filePath, text, scripts) {
  for (const command of findNpmRunCommands(text)) {
    const workspaceKey = command.workspace ?? "root";
    const target = scripts.get(workspaceKey);
    if (!target) {
      errors.push(
        `${relative(filePath)}:${lineNumber(text, command.index)} references unknown npm workspace ${workspaceKey}`,
      );
      continue;
    }
    if (!target.scripts.has(command.script)) {
      errors.push(
        `${relative(filePath)}:${lineNumber(text, command.index)} references npm script ${command.script} missing from ${target.workspace}`,
      );
    }
  }
}

function checkRetiredReferences(filePath, text) {
  for (const pattern of retiredReferences) {
    const match = pattern.exec(text);
    if (match) {
      errors.push(
        `${relative(filePath)}:${lineNumber(text, match.index)} references retired documentation ${match[0]}`,
      );
    }
    pattern.lastIndex = 0;
  }
}

function checkVersionAndSchema() {
  const rootPackage = JSON.parse(read(path.join(ROOT, "package.json")));
  const desktopPackage = JSON.parse(
    read(path.join(ROOT, "apps/desktop/package.json")),
  );
  if (rootPackage.version !== desktopPackage.version) {
    errors.push(
      `Release version mismatch: root=${rootPackage.version}, desktop=${desktopPackage.version}`,
    );
  }

  const rootReadme = read(path.join(ROOT, "README.md"));
  const releaseMarker = `当前发布基线为 \`${rootPackage.version}\``;
  if (!rootReadme.includes(releaseMarker)) {
    errors.push(`README.md must contain the release marker: ${releaseMarker}`);
  }

  const schemaSource = read(
    path.join(ROOT, "packages/db/src/currentSchema.ts"),
  );
  const schemaMatch = schemaSource.match(/CURRENT_SCHEMA_VERSION\s*=\s*(\d+)/u);
  if (!schemaMatch) {
    errors.push("Could not read CURRENT_SCHEMA_VERSION from currentSchema.ts");
    return;
  }

  const dataModel = read(path.join(ROOT, "DOCS/DATA_MODEL.md"));
  const schemaMarker = `current schema marker is **v${schemaMatch[1]}**`;
  if (!dataModel.includes(schemaMarker)) {
    errors.push(
      `DOCS/DATA_MODEL.md must contain the schema marker: ${schemaMarker}`,
    );
  }
}

function main() {
  checkDocSet();
  const scripts = collectPackageScripts();
  for (const entrypoint of entrypoints) {
    const filePath = path.join(ROOT, entrypoint);
    if (!fs.existsSync(filePath)) {
      errors.push(`Missing documentation entrypoint: ${entrypoint}`);
      continue;
    }
    const text = read(filePath);
    checkMarkdownLinks(filePath, text);
    checkMarkdownTables(filePath, text);
    checkScriptReferences(filePath, text, scripts);
    checkRetiredReferences(filePath, text);
  }
  checkVersionAndSchema();

  if (errors.length > 0) {
    process.stderr.write(`Documentation check failed (${errors.length}):\n`);
    for (const error of errors) process.stderr.write(`- ${error}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Documentation check passed (${entrypoints.length} entrypoints, ${checkedLinks} local links).\n`,
    );
  }
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));
if (isMain) main();
