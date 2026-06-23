# Desktop Paste Source File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a desktop `+ Add File -> Paste` flow that creates a normal project file from pasted source-column content.

**Architecture:** Renderer reads clipboard content through a typed desktop API, parses and previews pasted source cells, then sends validated source strings to main. Main creates an internal two-column CSV in the existing project file cache and reuses `SpreadsheetFilter.import()` so paste-created files behave like imported spreadsheet files.

**Tech Stack:** Electron IPC, React 18, TypeScript, Vitest, Node `fs/promises`, existing `@cat/core` tag policy types, existing desktop `ProjectService` / `ProjectFileModule` boundaries.

---

## File Structure

- `apps/desktop/src/shared/ipc.ts`: add clipboard and paste-create DTOs to the shared desktop API contract.
- `apps/desktop/src/shared/ipcChannels.ts`: add `clipboard.read` and `project.createPastedSourceFile` channels.
- `apps/desktop/src/main/ipc/types.ts`: add a narrow clipboard dependency interface for handler tests.
- `apps/desktop/src/main/ipc/clipboardHandlers.ts`: register the clipboard read IPC handler.
- `apps/desktop/src/main/ipc/handlerRegistration.test.ts`: ensure the new clipboard channel is registered.
- `apps/desktop/src/main/index.ts`: import Electron `clipboard` and register clipboard handlers.
- `apps/desktop/src/preload/api/clipboardApi.ts`: expose `readClipboard`.
- `apps/desktop/src/preload/api/projectApi.ts`: expose `createPastedSourceFile`.
- `apps/desktop/src/preload/api/createDesktopApi.ts`: compose the clipboard API.
- `apps/desktop/src/preload/api/createDesktopApi.test.ts`: cover both new preload mappings.
- `apps/desktop/src/renderer/src/components/project-detail/pasteSourceParser.ts`: pure clipboard/text parsing helpers for renderer preview and create payloads.
- `apps/desktop/src/renderer/src/components/project-detail/pasteSourceParser.test.ts`: parser coverage for HTML tables, TSV, CSV, plain text, first-column selection, skipped blanks, and multiline cells.
- `apps/desktop/src/main/services/modules/pastedSourceFile.ts`: pure filename, CSV serialization, and source normalization helpers for main-process file creation.
- `apps/desktop/src/main/services/modules/pastedSourceFile.test.ts`: filename and CSV helper coverage.
- `apps/desktop/src/main/services/modules/ProjectFileModule.ts`: add `createPastedSourceFile`.
- `apps/desktop/src/main/services/modules/ProjectFileModule.test.ts`: cover generated CSV import and cleanup behavior.
- `apps/desktop/src/main/services/ProjectService.ts`: delegate `createPastedSourceFile` to `ProjectFileModule`.
- `apps/desktop/src/main/ipc/projectHandlers.ts`: route the new project IPC channel.
- `apps/desktop/src/renderer/src/components/project-detail/PasteSourceModal.tsx`: modal for review/edit/create.
- `apps/desktop/src/renderer/src/components/project-detail/PasteSourceModal.test.ts`: modal render and disabled-state tests.
- `apps/desktop/src/renderer/src/hooks/projectDetail/useProjectFileImport.ts`: add import-menu state and paste-create orchestration.
- `apps/desktop/src/renderer/src/components/ProjectDetail.tsx`: replace the single `+ Add File` action with a two-item `Import` / `Paste` menu.

---

### Task 1: IPC And Clipboard Contract

**Files:**
- Modify: `apps/desktop/src/shared/ipc.ts`
- Modify: `apps/desktop/src/shared/ipcChannels.ts`
- Modify: `apps/desktop/src/main/ipc/types.ts`
- Create: `apps/desktop/src/main/ipc/clipboardHandlers.ts`
- Modify: `apps/desktop/src/main/ipc/handlerRegistration.test.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Create: `apps/desktop/src/preload/api/clipboardApi.ts`
- Modify: `apps/desktop/src/preload/api/projectApi.ts`
- Modify: `apps/desktop/src/preload/api/createDesktopApi.ts`
- Modify: `apps/desktop/src/preload/api/createDesktopApi.test.ts`

- [ ] **Step 1: Add failing preload and handler-registration assertions**

In `apps/desktop/src/preload/api/createDesktopApi.test.ts`, add calls and expectations inside `maps core domain methods to expected IPC channels`:

```ts
await api.readClipboard();
await api.createPastedSourceFile(12, {
  sources: ['A', 'BB'],
  tagPolicy: 'default',
});
```

Add these expectations near the existing project/dialog expectations:

```ts
expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.clipboard.read);
expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.project.createPastedSourceFile, 12, {
  sources: ['A', 'BB'],
  tagPolicy: 'default',
});
```

In `apps/desktop/src/main/ipc/handlerRegistration.test.ts`, import and register the clipboard handlers:

```ts
import { registerClipboardHandlers } from './clipboardHandlers';
```

Add this fake dependency inside the test before registrations:

```ts
const clipboard = {
  readText: vi.fn(),
  readHTML: vi.fn(),
};
```

Call the new registration after dialog registration:

```ts
registerClipboardHandlers({ ipcMain, clipboard });
```

Add clipboard channels to `expectedChannels`:

```ts
...Object.values(IPC_CHANNELS.clipboard),
```

- [ ] **Step 2: Run tests to verify the contract fails**

Run:

```bash
npx vitest run apps/desktop/src/preload/api/createDesktopApi.test.ts apps/desktop/src/main/ipc/handlerRegistration.test.ts
```

Expected: FAIL because `IPC_CHANNELS.clipboard`, `project.createPastedSourceFile`, `api.readClipboard`, `api.createPastedSourceFile`, and `registerClipboardHandlers` do not exist yet.

- [ ] **Step 3: Add shared API types and channels**

In `apps/desktop/src/shared/ipc.ts`, add these interfaces near the existing dialog/file API types:

```ts
export interface ClipboardContent {
  text: string;
  html: string;
}

export interface PastedSourceFileInput {
  sources: string[];
  tagPolicy?: TagPolicy;
}
```

Add these methods to `DesktopApi`:

```ts
createPastedSourceFile: (
  projectId: number,
  input: PastedSourceFileInput,
) => Promise<ProjectFileRecord>;
readClipboard: () => Promise<ClipboardContent>;
```

In `apps/desktop/src/shared/ipcChannels.ts`, add the project channel:

```ts
createPastedSourceFile: 'project-create-pasted-source-file',
```

inside `project`, and add a new top-level clipboard section:

```ts
clipboard: {
  read: 'clipboard-read',
},
```

- [ ] **Step 4: Add preload API mappings**

Create `apps/desktop/src/preload/api/clipboardApi.ts`:

```ts
import type { DesktopApi } from '../../shared/ipc';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { DesktopApiSlice, IpcRendererLike } from './types';

type ClipboardApiKeys = 'readClipboard';

export function createClipboardApi(
  ipcRenderer: IpcRendererLike,
): DesktopApiSlice<ClipboardApiKeys> {
  return {
    readClipboard: () =>
      ipcRenderer.invoke(IPC_CHANNELS.clipboard.read) as ReturnType<DesktopApi['readClipboard']>,
  };
}
```

In `apps/desktop/src/preload/api/projectApi.ts`, add `createPastedSourceFile` to `ProjectApiKeys` and add this mapping:

```ts
createPastedSourceFile: (projectId, input) =>
  ipcRenderer.invoke(
    IPC_CHANNELS.project.createPastedSourceFile,
    projectId,
    input,
  ) as ReturnType<DesktopApi['createPastedSourceFile']>,
```

In `apps/desktop/src/preload/api/createDesktopApi.ts`, import and compose the clipboard API:

```ts
import { createClipboardApi } from './clipboardApi';
```

```ts
...createClipboardApi(ipcRenderer),
```

- [ ] **Step 5: Add main clipboard handler**

In `apps/desktop/src/main/ipc/types.ts`, add:

```ts
export interface ClipboardLike {
  readText: () => string;
  readHTML: () => string;
}

export interface ClipboardHandlerDeps {
  ipcMain: IpcMainLike;
  clipboard: ClipboardLike;
}
```

Create `apps/desktop/src/main/ipc/clipboardHandlers.ts`:

```ts
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { ClipboardHandlerDeps } from './types';

function registerHandle(
  deps: ClipboardHandlerDeps,
  channel: string,
  listener: (event: unknown, ...args: unknown[]) => unknown,
) {
  deps.ipcMain.removeHandler?.(channel);
  deps.ipcMain.handle(channel, listener);
}

export function registerClipboardHandlers({ ipcMain, clipboard }: ClipboardHandlerDeps): void {
  registerHandle({ ipcMain, clipboard }, IPC_CHANNELS.clipboard.read, () => ({
    text: clipboard.readText() || '',
    html: clipboard.readHTML() || '',
  }));
}
```

In `apps/desktop/src/main/index.ts`, add `clipboard` to the Electron import:

```ts
import { app, shell, BrowserWindow, ipcMain, dialog, clipboard } from 'electron';
```

Import and register the handler:

```ts
import { registerClipboardHandlers } from './ipc/clipboardHandlers';
```

```ts
registerClipboardHandlers({ ipcMain, clipboard });
```

- [ ] **Step 6: Add project IPC delegation**

In `apps/desktop/src/main/ipc/projectHandlers.ts`, add the handler now, even though `ProjectService` fails typecheck until Task 3:

```ts
registerHandle(
  { ipcMain, projectService },
  IPC_CHANNELS.project.createPastedSourceFile,
  (_event, ...args) => {
    const [projectId, input] = args as [number, PastedSourceFileInput];
    const service = projectService as typeof projectService & {
      createPastedSourceFile: (
        nextProjectId: number,
        nextInput: PastedSourceFileInput,
      ) => unknown;
    };
    return service.createPastedSourceFile(projectId, input);
  },
);
```

Update imports:

```ts
import type { ImportOptions, PastedSourceFileInput } from '../../shared/ipc';
```

- [ ] **Step 7: Run contract tests**

Run:

```bash
npx vitest run apps/desktop/src/preload/api/createDesktopApi.test.ts apps/desktop/src/main/ipc/handlerRegistration.test.ts
```

Expected: PASS for contract tests. Typecheck remains clean because the handler uses a narrow local cast until `ProjectService.createPastedSourceFile` is implemented in Task 3.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/shared/ipc.ts apps/desktop/src/shared/ipcChannels.ts apps/desktop/src/main/ipc/types.ts apps/desktop/src/main/ipc/clipboardHandlers.ts apps/desktop/src/main/ipc/handlerRegistration.test.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/api/clipboardApi.ts apps/desktop/src/preload/api/projectApi.ts apps/desktop/src/preload/api/createDesktopApi.ts apps/desktop/src/preload/api/createDesktopApi.test.ts
git commit -m "feat: add paste source IPC contracts"
```

---

### Task 2: Renderer Clipboard Parsing Helpers

**Files:**
- Create: `apps/desktop/src/renderer/src/components/project-detail/pasteSourceParser.ts`
- Create: `apps/desktop/src/renderer/src/components/project-detail/pasteSourceParser.test.ts`

- [ ] **Step 1: Write failing parser tests**

Create `apps/desktop/src/renderer/src/components/project-detail/pasteSourceParser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parsePastedSources } from './pasteSourceParser';

describe('parsePastedSources', () => {
  it('reads the first column from HTML tables and preserves cell line breaks', () => {
    const html = `
      <table>
        <tbody>
          <tr><td>A<br>line 2</td><td>ignored target</td></tr>
          <tr><td> BB </td><td>ignored</td></tr>
          <tr><td></td><td>ignored empty source</td></tr>
        </tbody>
      </table>
    `;

    expect(parsePastedSources({ html, text: 'flattened text that should not win' })).toEqual([
      'A\nline 2',
      'BB',
    ]);
  });

  it('uses the first tab-separated column and skips blank first cells', () => {
    expect(
      parsePastedSources({
        html: '',
        text: 'A\ttranslated A\n\tblank source\nBB\ttranslated BB',
      }),
    ).toEqual(['A', 'BB']);
  });

  it('parses quoted TSV cells with embedded newlines', () => {
    expect(
      parsePastedSources({
        html: '',
        text: '"A\nline 2"\tignored\n"BB"\tignored',
      }),
    ).toEqual(['A\nline 2', 'BB']);
  });

  it('parses quoted CSV cells with embedded newlines only when quotes indicate CSV', () => {
    expect(
      parsePastedSources({
        html: '',
        text: '"A\nline 2",ignored\n"BB",ignored',
      }),
    ).toEqual(['A\nline 2', 'BB']);
  });

  it('falls back to plain text lines and keeps comma text intact', () => {
    expect(
      parsePastedSources({
        html: '',
        text: 'Hello, world\n\nBB',
      }),
    ).toEqual(['Hello, world', 'BB']);
  });
});
```

- [ ] **Step 2: Run parser tests to verify they fail**

Run:

```bash
npx vitest run apps/desktop/src/renderer/src/components/project-detail/pasteSourceParser.test.ts
```

Expected: FAIL because `pasteSourceParser.ts` does not exist.

- [ ] **Step 3: Implement parser helpers**

Create `apps/desktop/src/renderer/src/components/project-detail/pasteSourceParser.ts`:

```ts
export interface PastedClipboardData {
  html?: string;
  text?: string;
}

export function parsePastedSources(data: PastedClipboardData): string[] {
  const htmlSources = parseHtmlTableSources(data.html || '');
  if (htmlSources.length > 0) return htmlSources;

  const text = data.text || '';
  const tableTextSources = parseStructuredTextSources(text);
  if (tableTextSources.length > 0) return tableTextSources;

  return normalizeSourceCells(text.split(/\r\n|\n|\r/));
}

function parseHtmlTableSources(html: string): string[] {
  if (!html.trim() || typeof DOMParser === 'undefined') return [];

  const document = new DOMParser().parseFromString(html, 'text/html');
  const rows = Array.from(document.querySelectorAll('tr'));
  if (rows.length === 0) return [];

  return normalizeSourceCells(
    rows.map((row) => {
      const firstCell = row.querySelector('td,th');
      return firstCell ? getHtmlCellText(firstCell) : '';
    }),
  );
}

function getHtmlCellText(cell: Element): string {
  const clone = cell.cloneNode(true) as Element;
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  return clone.textContent || '';
}

function parseStructuredTextSources(text: string): string[] {
  if (!text.trim()) return [];

  if (text.includes('\t')) {
    return normalizeSourceCells(parseDelimitedRows(text, '\t').map((row) => row[0] || ''));
  }

  if (looksLikeQuotedCsv(text)) {
    return normalizeSourceCells(parseDelimitedRows(text, ',').map((row) => row[0] || ''));
  }

  return [];
}

function looksLikeQuotedCsv(text: string): boolean {
  return /(^|[\r\n])\s*"/.test(text) && text.includes(',');
}

function parseDelimitedRows(text: string, delimiter: '\t' | ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell);
      cell = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function normalizeSourceCells(cells: string[]): string[] {
  return cells
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
}
```

- [ ] **Step 4: Run parser tests to verify they pass**

Run:

```bash
npx vitest run apps/desktop/src/renderer/src/components/project-detail/pasteSourceParser.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/project-detail/pasteSourceParser.ts apps/desktop/src/renderer/src/components/project-detail/pasteSourceParser.test.ts
git commit -m "feat: parse pasted source clipboard data"
```

---

### Task 3: Main Process Paste File Creation

**Files:**
- Create: `apps/desktop/src/main/services/modules/pastedSourceFile.ts`
- Create: `apps/desktop/src/main/services/modules/pastedSourceFile.test.ts`
- Modify: `apps/desktop/src/main/services/modules/ProjectFileModule.ts`
- Modify: `apps/desktop/src/main/services/modules/ProjectFileModule.test.ts`
- Modify: `apps/desktop/src/main/services/ProjectService.ts`
- Modify: `apps/desktop/src/main/ipc/projectHandlers.ts`

- [ ] **Step 1: Write failing helper tests**

Create `apps/desktop/src/main/services/modules/pastedSourceFile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildPastedSourceCsv,
  buildPastedSourceFileName,
  normalizePastedSources,
} from './pastedSourceFile';

describe('pasted source file helpers', () => {
  it('normalizes sources by trimming and skipping empty values', () => {
    expect(normalizePastedSources([' A ', '', '  ', 'BB'])).toEqual(['A', 'BB']);
  });

  it('creates recognizable sanitized file names from the first source and timestamp', () => {
    const now = new Date('2026-06-23T08:30:00.000Z');

    expect(buildPastedSourceFileName('Login: failed / retry?', now, [])).toBe(
      'Login failed retry-2026-06-23-08-30.csv',
    );
  });

  it('truncates long source summaries and resolves duplicate file names', () => {
    const now = new Date('2026-06-23T08:30:00.000Z');
    const existing = ['This is a very long source title that should-2026-06-23-08-30.csv'];

    expect(
      buildPastedSourceFileName(
        'This is a very long source title that should be clipped after forty chars',
        now,
        existing,
      ),
    ).toBe('This is a very long source title that should-2026-06-23-08-30-2.csv');
  });

  it('falls back when the first source cannot produce a name', () => {
    const now = new Date('2026-06-23T08:30:00.000Z');

    expect(buildPastedSourceFileName('////', now, [])).toBe(
      'Pasted Source-2026-06-23-08-30.csv',
    );
  });

  it('serializes sources to a two-column CSV with blank targets', () => {
    expect(buildPastedSourceCsv(['A', 'B, C', 'Line 1\nLine 2', 'He said "yes"'])).toBe(
      'Source,Target\r\nA,\r\n"B, C",\r\n"Line 1\nLine 2",\r\n"He said ""yes""",',
    );
  });
});
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run:

```bash
npx vitest run apps/desktop/src/main/services/modules/pastedSourceFile.test.ts
```

Expected: FAIL because `pastedSourceFile.ts` does not exist.

- [ ] **Step 3: Implement main helper functions**

Create `apps/desktop/src/main/services/modules/pastedSourceFile.ts`:

```ts
const INVALID_FILE_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g;
const MAX_SOURCE_SUMMARY_LENGTH = 40;

export function normalizePastedSources(sources: string[]): string[] {
  return sources.map((source) => source.trim()).filter((source) => source.length > 0);
}

export function buildPastedSourceFileName(
  firstSource: string,
  now: Date,
  existingFileNames: string[],
): string {
  const timestamp = formatTimestamp(now);
  const summary = sanitizeFileSummary(firstSource) || 'Pasted Source';
  const baseName = `${summary}-${timestamp}`;
  const existing = new Set(existingFileNames);
  let candidate = `${baseName}.csv`;
  let suffix = 2;

  while (existing.has(candidate)) {
    candidate = `${baseName}-${suffix}.csv`;
    suffix += 1;
  }

  return candidate;
}

export function buildPastedSourceCsv(sources: string[]): string {
  const rows = [['Source', 'Target'], ...sources.map((source) => [source, ''])];
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}

function sanitizeFileSummary(source: string): string {
  return source
    .replace(INVALID_FILE_NAME_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SOURCE_SUMMARY_LENGTH)
    .trim();
}

function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}-${hours}-${minutes}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

function escapeCsvCell(value: string): string {
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!/[",\n]/.test(normalized)) return normalized;
  return `"${normalized.replace(/"/g, '""')}"`;
}
```

- [ ] **Step 4: Run helper tests to verify they pass**

Run:

```bash
npx vitest run apps/desktop/src/main/services/modules/pastedSourceFile.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing ProjectFileModule tests**

In `apps/desktop/src/main/services/modules/ProjectFileModule.test.ts`, add imports:

```ts
import { readFileSync } from 'fs';
```

Add this `describe` block before `ProjectFileModule.runFileQA`:

```ts
describe('ProjectFileModule.createPastedSourceFile', () => {
  it('writes an internal CSV and imports it through the spreadsheet gateway', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'project-file-module-paste-'));
    const createdFileId = 77;
    const optionsJson: string[] = [];
    let importedPath = '';

    const projectRepo = {
      getProject: vi.fn().mockReturnValue({ id: 1 }),
      listFiles: vi.fn().mockReturnValue([]),
      createFile: vi.fn().mockImplementation((_projectId, _name, importOptionsJson) => {
        optionsJson.push(importOptionsJson);
        return createdFileId;
      }),
      deleteFile: vi.fn(),
      getFile: vi.fn().mockReturnValue({
        id: createdFileId,
        projectId: 1,
        name: 'A-2026-06-23-08-30.csv',
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      bulkInsertSegments: vi.fn(),
    } as unknown as SegmentRepository;

    const filter = {
      import: vi.fn().mockImplementation(async (filePath: string) => {
        importedPath = filePath;
        return [
          {
            segmentId: 'seg-1',
            fileId: createdFileId,
            orderIndex: 1,
            sourceTokens: [{ type: 'text', content: 'A' }],
            targetTokens: [],
            status: 'new',
            tagsSignature: '',
            matchKey: 'a',
            srcHash: 'hash-a',
            meta: { rowRef: 2, updatedAt: new Date().toISOString() },
          },
        ] satisfies Segment[];
      }),
      export: vi.fn(),
      getPreview: vi.fn(),
    } as unknown as SpreadsheetGateway;

    const module = new ProjectFileModule(projectRepo, segmentRepo, filter, rootDir);
    const file = await module.createPastedSourceFile(
      1,
      { sources: ['A', 'B, C'], tagPolicy: 'none' },
      new Date('2026-06-23T08:30:00.000Z'),
    );

    expect(file.id).toBe(createdFileId);
    expect(projectRepo.createFile).toHaveBeenCalledWith(
      1,
      'A-2026-06-23-08-30.csv',
      JSON.stringify({
        hasHeader: true,
        sourceCol: 0,
        targetCol: 1,
        tagPolicy: 'none',
      }),
    );
    expect(readFileSync(importedPath, 'utf8')).toBe('Source,Target\r\nA,\r\n"B, C",');
    expect(filter.import).toHaveBeenCalledWith(
      importedPath,
      1,
      createdFileId,
      JSON.parse(optionsJson[0]),
    );
    expect(segmentRepo.bulkInsertSegments).toHaveBeenCalledTimes(1);

    rmSync(rootDir, { recursive: true, force: true });
  });

  it('rejects empty pasted sources before creating a file record', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'project-file-module-paste-'));
    const projectRepo = {
      getProject: vi.fn().mockReturnValue({ id: 1 }),
      listFiles: vi.fn().mockReturnValue([]),
      createFile: vi.fn(),
    } as unknown as ProjectRepository;
    const segmentRepo = {
      bulkInsertSegments: vi.fn(),
    } as unknown as SegmentRepository;
    const filter = {
      import: vi.fn(),
      export: vi.fn(),
      getPreview: vi.fn(),
    } as unknown as SpreadsheetGateway;

    const module = new ProjectFileModule(projectRepo, segmentRepo, filter, rootDir);

    await expect(module.createPastedSourceFile(1, { sources: [' ', ''] })).rejects.toThrow(
      'No valid pasted source rows found.',
    );
    expect(projectRepo.createFile).not.toHaveBeenCalled();

    rmSync(rootDir, { recursive: true, force: true });
  });

  it('cleans up the file record and generated CSV when segment persistence fails', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'project-file-module-paste-'));
    const createdFileId = 78;
    let generatedPath = '';

    const projectRepo = {
      getProject: vi.fn().mockReturnValue({ id: 1 }),
      listFiles: vi.fn().mockReturnValue([]),
      createFile: vi.fn().mockReturnValue(createdFileId),
      deleteFile: vi.fn(),
      getFile: vi.fn(),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      bulkInsertSegments: vi.fn().mockImplementation(() => {
        throw new Error('Insert failed');
      }),
    } as unknown as SegmentRepository;

    const filter = {
      import: vi.fn().mockImplementation(async (filePath: string) => {
        generatedPath = filePath;
        return [
          {
            segmentId: 'seg-1',
            fileId: createdFileId,
            orderIndex: 1,
            sourceTokens: [{ type: 'text', content: 'A' }],
            targetTokens: [],
            status: 'new',
            tagsSignature: '',
            matchKey: 'a',
            srcHash: 'hash-a',
            meta: { rowRef: 2, updatedAt: new Date().toISOString() },
          },
        ] satisfies Segment[];
      }),
      export: vi.fn(),
      getPreview: vi.fn(),
    } as unknown as SpreadsheetGateway;

    const module = new ProjectFileModule(projectRepo, segmentRepo, filter, rootDir);

    await expect(module.createPastedSourceFile(1, { sources: ['A'] })).rejects.toThrow(
      'Insert failed',
    );
    expect(projectRepo.deleteFile).toHaveBeenCalledWith(createdFileId);
    expect(existsSync(generatedPath)).toBe(false);

    rmSync(rootDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 6: Run ProjectFileModule tests to verify they fail**

Run:

```bash
npx vitest run apps/desktop/src/main/services/modules/ProjectFileModule.test.ts
```

Expected: FAIL because `createPastedSourceFile` does not exist.

- [ ] **Step 7: Implement `createPastedSourceFile`**

In `apps/desktop/src/main/services/modules/ProjectFileModule.ts`, extend imports:

```ts
import { basename, join } from 'path';
import { copyFile, mkdir, rm, unlink, writeFile } from 'fs/promises';
```

Add imports:

```ts
import type { PastedSourceFileInput } from '../../../shared/ipc';
import {
  buildPastedSourceCsv,
  buildPastedSourceFileName,
  normalizePastedSources,
} from './pastedSourceFile';
```

Add this public method near `addFileToProject`:

```ts
public async createPastedSourceFile(
  projectId: number,
  input: PastedSourceFileInput,
  now: Date = new Date(),
) {
  const project = this.projectRepo.getProject(projectId);
  if (!project) throw new Error('Project not found');

  const sources = normalizePastedSources(input.sources);
  if (sources.length === 0) {
    throw new Error('No valid pasted source rows found.');
  }

  const options: ImportOptions = {
    hasHeader: true,
    sourceCol: 0,
    targetCol: 1,
    tagPolicy: input.tagPolicy || 'default',
  };

  const projectDir = join(this.projectsDir, projectId.toString());
  await this.ensureDirectory(this.projectsDir);
  await this.ensureDirectory(projectDir);

  const existingNames = this.projectRepo.listFiles(projectId).map((file) => file.name);
  const fileName = buildPastedSourceFileName(sources[0], now, existingNames);

  let fileId: number | undefined;
  let storedPath: string | undefined;

  try {
    fileId = this.projectRepo.createFile(projectId, fileName, JSON.stringify(options));
    storedPath = join(projectDir, `${fileId}_${fileName}`);
    await writeFile(storedPath, buildPastedSourceCsv(sources), 'utf8');

    const segments = await this.filter.import(storedPath, projectId, fileId, options);
    if (segments.length === 0) {
      throw new Error('No valid segments found in the pasted source content.');
    }

    this.segmentRepo.bulkInsertSegments(segments);

    const file = this.projectRepo.getFile(fileId);
    if (!file) throw new Error('Failed to retrieve created file');

    return file;
  } catch (error) {
    const originalError = error instanceof Error ? error : new Error(String(error));
    const cleanupErrors: Error[] = [];

    if (fileId !== undefined) {
      try {
        this.projectRepo.deleteFile(fileId);
      } catch (cleanupError) {
        console.warn(
          '[ProjectFileModule] Failed to cleanup pasted file record after import failure:',
          cleanupError,
        );
        cleanupErrors.push(
          cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)),
        );
      }
    }

    if (storedPath) {
      try {
        await unlink(storedPath);
      } catch (cleanupError) {
        if (!this.isFileNotFoundError(cleanupError)) {
          console.warn(
            '[ProjectFileModule] Failed to cleanup pasted source file after import failure:',
            cleanupError,
          );
          cleanupErrors.push(
            cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)),
          );
        }
      }
    }

    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [originalError, ...cleanupErrors],
        `[ProjectFileModule] Pasted source import failed and cleanup encountered ${cleanupErrors.length} error(s)`,
      );
    }

    throw originalError;
  }
}
```

- [ ] **Step 8: Add service delegation**

In `apps/desktop/src/main/services/ProjectService.ts`, import `PastedSourceFileInput` from shared IPC and add:

```ts
public async createPastedSourceFile(projectId: number, input: PastedSourceFileInput) {
  return this.projectModule.createPastedSourceFile(projectId, input);
}
```

If `PastedSourceFileInput` is added to the existing shared import list, keep the list alphabetical within the local style:

```ts
ImportOptions,
PastedSourceFileInput,
ProxySettings,
```

In `apps/desktop/src/main/ipc/projectHandlers.ts`, simplify the handler added in Task 1 now that `ProjectService` has the real method:

```ts
registerHandle(
  { ipcMain, projectService },
  IPC_CHANNELS.project.createPastedSourceFile,
  (_event, ...args) => {
    const [projectId, input] = args as [number, PastedSourceFileInput];
    return projectService.createPastedSourceFile(projectId, input);
  },
);
```

- [ ] **Step 9: Run main tests**

Run:

```bash
npx vitest run apps/desktop/src/main/services/modules/pastedSourceFile.test.ts apps/desktop/src/main/services/modules/ProjectFileModule.test.ts apps/desktop/src/preload/api/createDesktopApi.test.ts apps/desktop/src/main/ipc/handlerRegistration.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src/main/services/modules/pastedSourceFile.ts apps/desktop/src/main/services/modules/pastedSourceFile.test.ts apps/desktop/src/main/services/modules/ProjectFileModule.ts apps/desktop/src/main/services/modules/ProjectFileModule.test.ts apps/desktop/src/main/services/ProjectService.ts apps/desktop/src/main/ipc/projectHandlers.ts
git commit -m "feat: create project files from pasted sources"
```

---

### Task 4: Paste Source Modal And Project Detail Menu

**Files:**
- Create: `apps/desktop/src/renderer/src/components/project-detail/PasteSourceModal.tsx`
- Create: `apps/desktop/src/renderer/src/components/project-detail/PasteSourceModal.test.ts`
- Modify: `apps/desktop/src/renderer/src/hooks/projectDetail/useProjectFileImport.ts`
- Modify: `apps/desktop/src/renderer/src/components/ProjectDetail.tsx`

- [ ] **Step 1: Write failing modal tests**

Create `apps/desktop/src/renderer/src/components/project-detail/PasteSourceModal.test.ts`:

```ts
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PasteSourceModal } from './PasteSourceModal';

describe('PasteSourceModal', () => {
  it('renders parsed source count, preview rows, and marker handling controls', () => {
    const html = renderToStaticMarkup(
      React.createElement(PasteSourceModal, {
        open: true,
        clipboard: { html: '', text: 'A\nBB' },
        creating: false,
        onClose: vi.fn(),
        onCreate: vi.fn(),
      }),
    );

    expect(html).toContain('Paste Source');
    expect(html).toContain('2 source rows');
    expect(html).toContain('A');
    expect(html).toContain('BB');
    expect(html).toContain('Protect CAT markers');
    expect(html).toContain('Plain marker-like text');
    expect(html).toContain('Create File');
  });

  it('disables creation when there are no valid sources', () => {
    const html = renderToStaticMarkup(
      React.createElement(PasteSourceModal, {
        open: true,
        clipboard: { html: '', text: '  \n\n' },
        creating: false,
        onClose: vi.fn(),
        onCreate: vi.fn(),
      }),
    );

    expect(html).toContain('No valid source rows found.');
    expect(html).toContain('disabled=""');
  });

  it('shows a soft warning for large pastes', () => {
    const rows = Array.from({ length: 5001 }, (_, index) => `row ${index + 1}`).join('\n');
    const html = renderToStaticMarkup(
      React.createElement(PasteSourceModal, {
        open: true,
        clipboard: { html: '', text: rows },
        creating: false,
        onClose: vi.fn(),
        onCreate: vi.fn(),
      }),
    );

    expect(html).toContain('5,001 source rows');
    expect(html).toContain('Large paste');
  });
});
```

- [ ] **Step 2: Run modal tests to verify they fail**

Run:

```bash
npx vitest run apps/desktop/src/renderer/src/components/project-detail/PasteSourceModal.test.ts
```

Expected: FAIL because `PasteSourceModal.tsx` does not exist.

- [ ] **Step 3: Implement `PasteSourceModal`**

Create `apps/desktop/src/renderer/src/components/project-detail/PasteSourceModal.tsx`:

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import type { TagPolicy } from '@cat/core/tag';
import type { ClipboardContent, PastedSourceFileInput } from '../../../../shared/ipc';
import { Button, Card, Modal, Select, Textarea } from '../ui';
import { parsePastedSources } from './pasteSourceParser';

interface PasteSourceModalProps {
  open: boolean;
  clipboard: ClipboardContent;
  creating: boolean;
  onClose: () => void;
  onCreate: (input: PastedSourceFileInput) => void | Promise<void>;
}

const LARGE_PASTE_WARNING_THRESHOLD = 5000;

export function PasteSourceModal({
  open,
  clipboard,
  creating,
  onClose,
  onCreate,
}: PasteSourceModalProps) {
  const [text, setText] = useState(clipboard.text);
  const [tagPolicy, setTagPolicy] = useState<TagPolicy>('default');
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (!open) return;
    setText(clipboard.text);
    setTagPolicy('default');
    setIsDirty(false);
  }, [clipboard, open]);

  const sources = useMemo(
    () => parsePastedSources(isDirty ? { text } : clipboard),
    [clipboard, isDirty, text],
  );
  const previewSources = sources.slice(0, 8);
  const hasSources = sources.length > 0;
  const rowLabel = `${sources.length.toLocaleString()} source ${sources.length === 1 ? 'row' : 'rows'}`;

  return (
    <Modal
      open={open}
      onClose={creating ? undefined : onClose}
      title="Paste Source"
      size="xl"
      closeOnBackdrop={!creating}
      footer={
        <>
          <Button onClick={onClose} variant="secondary" size="lg" disabled={creating}>
            Cancel
          </Button>
          <Button
            onClick={() => void onCreate({ sources, tagPolicy })}
            variant="primary"
            size="lg"
            loading={creating}
            disabled={!hasSources || creating}
          >
            Create File
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setIsDirty(true);
          }}
          className="min-h-[220px] font-mono"
          aria-label="Source text"
        />

        <div className="flex flex-wrap items-center justify-between gap-4">
          <label className="flex items-center gap-3 text-sm font-medium text-text-muted">
            <span>Marker Handling</span>
            <Select
              value={tagPolicy}
              onChange={(event) => setTagPolicy(event.target.value as TagPolicy)}
              className="!w-auto min-w-[180px]"
            >
              <option value="default">Protect CAT markers</option>
              <option value="none">Plain marker-like text</option>
            </Select>
          </label>
          <span className="text-sm font-semibold text-text-muted">{rowLabel}</span>
        </div>

        {!hasSources && (
          <Card variant="danger" className="p-4 text-sm font-medium text-danger">
            No valid source rows found.
          </Card>
        )}

        {sources.length > LARGE_PASTE_WARNING_THRESHOLD && (
          <Card variant="subtle" className="p-4 text-sm font-medium text-warning">
            Large paste: {rowLabel}. Creation is allowed, but import may take longer.
          </Card>
        )}

        {hasSources && (
          <Card variant="surface" className="p-4">
            <h3 className="text-xs font-bold text-text-faint uppercase tracking-wider mb-3">
              Preview
            </h3>
            <ol className="space-y-2 text-sm text-text-muted">
              {previewSources.map((source, index) => (
                <li key={`${index}-${source}`} className="whitespace-pre-wrap">
                  <span className="text-text-faint mr-2">{index + 1}.</span>
                  {source}
                </li>
              ))}
            </ol>
          </Card>
        )}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Run modal tests**

Run:

```bash
npx vitest run apps/desktop/src/renderer/src/components/project-detail/PasteSourceModal.test.ts
```

Expected: PASS.

- [ ] **Step 5: Extend `useProjectFileImport` orchestration**

In `apps/desktop/src/renderer/src/hooks/projectDetail/useProjectFileImport.ts`, update imports:

```ts
import type {
  ClipboardContent,
  ImportOptions,
  PastedSourceFileInput,
  SpreadsheetPreviewData,
} from '../../../../shared/ipc';
```

Extend `UseProjectFileImportResult`:

```ts
isAddFileMenuOpen: boolean;
isPasteSourceOpen: boolean;
pasteClipboard: ClipboardContent;
pasteCreating: boolean;
toggleAddFileMenu: () => void;
closeAddFileMenu: () => void;
openPasteSource: () => Promise<void>;
closePasteSource: () => void;
confirmPasteSource: (input: PastedSourceFileInput) => Promise<void>;
```

Add state inside the hook:

```ts
const [isAddFileMenuOpen, setIsAddFileMenuOpen] = useState(false);
const [isPasteSourceOpen, setIsPasteSourceOpen] = useState(false);
const [pasteClipboard, setPasteClipboard] = useState<ClipboardContent>({ text: '', html: '' });
const [pasteCreating, setPasteCreating] = useState(false);
```

Add menu and paste actions:

```ts
const toggleAddFileMenu = () => {
  setIsAddFileMenuOpen((open) => !open);
};

const closeAddFileMenu = () => {
  setIsAddFileMenuOpen(false);
};
```

At the top of `openFileImport`, close the menu:

```ts
setIsAddFileMenuOpen(false);
```

Add:

```ts
const openPasteSource = async () => {
  setIsAddFileMenuOpen(false);
  try {
    const clipboard = await apiClient.readClipboard();
    setPasteClipboard(clipboard);
  } catch {
    setPasteClipboard({ text: '', html: '' });
  }
  setIsPasteSourceOpen(true);
};

const closePasteSource = () => {
  if (pasteCreating) return;
  setIsPasteSourceOpen(false);
};

const confirmPasteSource = async (input: PastedSourceFileInput) => {
  setPasteCreating(true);
  try {
    await runMutation(async () => {
      await apiClient.createPastedSourceFile(projectId, input);
      await loadData();
    });
    feedbackService.success('File created from pasted source');
    setIsPasteSourceOpen(false);
  } catch (error) {
    feedbackService.error(
      `Failed to create file: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    setPasteCreating(false);
  }
};
```

Return all new values from the hook.

- [ ] **Step 6: Wire modal and menu in `ProjectDetail`**

In `apps/desktop/src/renderer/src/components/ProjectDetail.tsx`, import the modal:

```ts
import { PasteSourceModal } from './project-detail/PasteSourceModal';
```

Render it near `ColumnSelector`:

```tsx
<PasteSourceModal
  open={fileImport.isPasteSourceOpen}
  clipboard={fileImport.pasteClipboard}
  creating={fileImport.pasteCreating}
  onClose={fileImport.closePasteSource}
  onCreate={(input) => void fileImport.confirmPasteSource(input)}
/>
```

Replace the current `+ Add File` button with a relative menu container:

```tsx
<div className="relative">
  <button
    onClick={fileImport.toggleAddFileMenu}
    disabled={loading}
    className="btn-primary"
  >
    + Add File
  </button>
  {fileImport.isAddFileMenuOpen && (
    <div className="absolute right-0 mt-2 w-40 surface-card p-1 shadow-float z-20">
      <button
        type="button"
        onClick={() => void fileImport.openFileImport()}
        className="w-full text-left px-3 py-2 text-sm font-semibold text-text-muted hover:text-text hover:bg-muted rounded-control"
      >
        Import
      </button>
      <button
        type="button"
        onClick={() => void fileImport.openPasteSource()}
        className="w-full text-left px-3 py-2 text-sm font-semibold text-text-muted hover:text-text hover:bg-muted rounded-control"
      >
        Paste
      </button>
    </div>
  )}
</div>
```

- [ ] **Step 7: Run renderer tests**

Run:

```bash
npx vitest run apps/desktop/src/renderer/src/components/project-detail/pasteSourceParser.test.ts apps/desktop/src/renderer/src/components/project-detail/PasteSourceModal.test.ts apps/desktop/src/renderer/src/components/project-detail/ProjectFilesPane.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/src/components/project-detail/PasteSourceModal.tsx apps/desktop/src/renderer/src/components/project-detail/PasteSourceModal.test.ts apps/desktop/src/renderer/src/hooks/projectDetail/useProjectFileImport.ts apps/desktop/src/renderer/src/components/ProjectDetail.tsx
git commit -m "feat: add desktop paste source UI"
```

---

### Task 5: Full Validation And Final Cleanup

**Files:**
- Review: `apps/desktop/src/shared/ipc.ts`
- Review: `apps/desktop/src/main/services/modules/ProjectFileModule.ts`
- Review: `apps/desktop/src/renderer/src/components/ProjectDetail.tsx`
- Review: `apps/desktop/src/renderer/src/components/project-detail/PasteSourceModal.tsx`
- Review: `DOCS/superpowers/specs/2026-06-23-desktop-paste-source-file-design.md`

- [ ] **Step 1: Run focused paste-source test suite**

Run:

```bash
npx vitest run apps/desktop/src/renderer/src/components/project-detail/pasteSourceParser.test.ts apps/desktop/src/renderer/src/components/project-detail/PasteSourceModal.test.ts apps/desktop/src/main/services/modules/pastedSourceFile.test.ts apps/desktop/src/main/services/modules/ProjectFileModule.test.ts apps/desktop/src/preload/api/createDesktopApi.test.ts apps/desktop/src/main/ipc/handlerRegistration.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run desktop typecheck**

Run:

```bash
npm run typecheck --workspace=apps/desktop
```

Expected: PASS.

- [ ] **Step 3: Run architecture gate**

Run:

```bash
npm run gate:arch
```

Expected: PASS. If this fails because a new boundary import is disallowed, move the helper to the closest allowed layer instead of weakening the guardrail.

- [ ] **Step 4: Run file-size gate**

Run:

```bash
npm run gate:file-size
```

Expected: PASS. If `ProjectDetail.tsx` or `ProjectFileModule.ts` exceeds the gate, extract only the new menu/modal or paste import logic; do not refactor unrelated behavior.

- [ ] **Step 5: Run lint for touched workspace**

Run:

```bash
npm run lint --workspace=apps/desktop
```

Expected: PASS.

- [ ] **Step 6: Optional desktop smoke if UI behavior needs runtime confirmation**

Run this if the menu/modal behavior cannot be trusted from unit tests alone:

```bash
npm run test:e2e:smoke --workspace=apps/desktop
```

Expected: PASS.

- [ ] **Step 7: Review final diff against success criteria**

Check:

```bash
git diff --stat
git diff -- apps/desktop/src/shared/ipc.ts apps/desktop/src/main/services/modules/ProjectFileModule.ts apps/desktop/src/renderer/src/components/ProjectDetail.tsx apps/desktop/src/renderer/src/components/project-detail/PasteSourceModal.tsx
```

Confirm the diff includes:

- `+ Add File` menu with `Import` and `Paste`
- clipboard reading through a typed API
- parser priority for HTML table, TSV/CSV, and plain text fallback
- first-column-only behavior
- empty source skip behavior
- marker handling selection
- main-process generated CSV with blank target column
- cleanup after create/import/persist failure

- [ ] **Step 8: Final commit**

If any cleanup changes were made after Task 4, commit them:

```bash
git add apps/desktop/src/shared/ipc.ts apps/desktop/src/shared/ipcChannels.ts apps/desktop/src/main apps/desktop/src/preload apps/desktop/src/renderer/src/components apps/desktop/src/renderer/src/hooks/projectDetail/useProjectFileImport.ts
git commit -m "test: validate pasted source file flow"
```

If no cleanup changes were made, do not create an empty commit.

---

## Self-Review Notes

- Spec coverage: Tasks cover menu naming, clipboard read, editable modal, marker handling, parser priority, first-column-only behavior, blank target creation, empty-row skip, recognizable filename, duplicate naming, generated CSV import reuse, cleanup, IPC/preload contracts, renderer tests, and validation.
- Scope: This plan does not change DB schema, TM/TB import, target-column paste import, or project-level defaults.
- Type consistency: The shared DTO is `PastedSourceFileInput`; the desktop API method is `createPastedSourceFile`; the IPC channel key is `project.createPastedSourceFile`; the service and module methods use the same name.
