# Desktop File Inspect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a desktop file-card `Inspect` action that exports the same source-row TM/TB/prompt inspection workbook and JSON sidecar as CLI inspect.

**Architecture:** Keep desktop thin: renderer owns the file action and save dialog, preload and IPC expose a typed bridge, main-process service code resolves the desktop file context, and `@cat/localization` `LocalizationInspector` owns all inspect behavior. The desktop call always uses `targetBaseline: 'ignore-current-targets'` so existing target cells do not skip source-row inspection.

**Tech Stack:** TypeScript, React, Electron IPC, Vitest, `@cat/localization` `LocalizationInspector`, existing desktop project file storage under `projectsDir`.

---

## File Map

- Modify `apps/desktop/src/shared/ipc.ts`
  - Add `FileInspectResult`.
  - Add `DesktopApi.inspectFile(fileId, outputPath)`.
- Modify `apps/desktop/src/shared/ipcChannels.ts`
  - Add `IPC_CHANNELS.file.inspect`.
- Modify `apps/desktop/src/preload/api/projectApi.ts`
  - Expose `inspectFile` through preload.
- Modify `apps/desktop/src/preload/api/createDesktopApi.test.ts`
  - Verify preload maps `inspectFile` to the new channel.
- Modify `apps/desktop/src/main/ipc/projectHandlers.ts`
  - Register the new file inspect handler.
- Test `apps/desktop/src/main/ipc/handlerRegistration.test.ts`
  - Existing channel coverage should include the new file channel once the handler is registered.
- Modify `apps/desktop/src/main/services/ProjectService.ts`
  - Create a `LocalizationInspector` runner and delegate `inspectFile` to `ProjectFileModule`.
- Modify `apps/desktop/src/main/services/modules/ProjectFileModule.ts`
  - Resolve stored file path and import columns from the desktop file record.
  - Call the injected inspect runner with `window-partial`, `ignore-current-targets`, and file `tagPolicy`.
- Modify `apps/desktop/src/main/services/modules/ProjectFileModule.test.ts`
  - Verify inspect input mapping and pre-inspect errors.
- Create `apps/desktop/src/main/services/ProjectService.test.ts`
  - Verify `ProjectService.inspectFile` delegates to the project file module.
- Create `apps/desktop/src/renderer/src/components/project-detail/fileInspectAction.ts`
  - Hold save-dialog defaults and feedback orchestration for the renderer action.
- Create `apps/desktop/src/renderer/src/components/project-detail/fileInspectAction.test.ts`
  - Verify save dialog, API call, success feedback, cancel behavior, and error feedback.
- Modify `apps/desktop/src/renderer/src/components/project-detail/ProjectFilesPane.tsx`
  - Add the `Inspect` button for translation projects.
- Modify `apps/desktop/src/renderer/src/components/project-detail/ProjectFilesPane.test.ts`
  - Verify `Inspect` appears for translation projects and not for non-translation projects.
- Modify `apps/desktop/src/renderer/src/components/project-detail/ProjectFilesPane.wiring.test.ts`
  - Add the required `onInspectFile` prop to existing test render setup.
- Modify `apps/desktop/src/renderer/src/components/ProjectDetail.tsx`
  - Wire the renderer action to `apiClient.saveFileDialog`, `apiClient.inspectFile`, and `feedbackService`.

---

### Task 1: Typed API And IPC Channel

**Files:**
- Modify: `apps/desktop/src/shared/ipc.ts`
- Modify: `apps/desktop/src/shared/ipcChannels.ts`
- Modify: `apps/desktop/src/preload/api/projectApi.ts`
- Modify: `apps/desktop/src/preload/api/createDesktopApi.test.ts`
- Modify: `apps/desktop/src/main/ipc/projectHandlers.ts`
- Test: `apps/desktop/src/main/ipc/handlerRegistration.test.ts`
- Modify: `apps/desktop/src/main/services/ProjectService.ts`
- Modify: `apps/desktop/src/main/services/modules/ProjectFileModule.ts`

- [ ] **Step 1: Add the failing preload mapping test**

Modify `apps/desktop/src/preload/api/createDesktopApi.test.ts`.

Inside the `maps core domain methods to expected IPC channels` test, add this API call after `await api.runFileQA(1);`:

```ts
await api.inspectFile(1, 'inspect.xlsx');
```

Add this expectation after the `runQA` expectation:

```ts
expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.file.inspect, 1, 'inspect.xlsx');
```

- [ ] **Step 2: Run the preload test and confirm it fails**

Run:

```bash
npx vitest run apps/desktop/src/preload/api/createDesktopApi.test.ts -t "maps core domain methods"
```

Expected: FAIL with `api.inspectFile is not a function` or a TypeScript/Vitest error showing the API method does not exist.

- [ ] **Step 3: Add the shared IPC contract**

Modify `apps/desktop/src/shared/ipc.ts`.

Add the result type near the file-related interfaces:

```ts
export interface FileInspectResult {
  outputPath: string;
  jsonOutputPath: string;
  summary: {
    total: number;
    ready: number;
    error: number;
  };
}
```

Add the method to `DesktopApi` after `runFileQA`:

```ts
inspectFile: (fileId: number, outputPath: string) => Promise<FileInspectResult>;
```

- [ ] **Step 4: Add the IPC channel constant**

Modify `apps/desktop/src/shared/ipcChannels.ts`.

Add `inspect` to `IPC_CHANNELS.file`:

```ts
file: {
  get: 'file-get',
  remove: 'file-delete',
  getSegments: 'file-get-segments',
  getPreview: 'file-get-preview',
  export: 'file-export',
  runQA: 'file-run-qa',
  inspect: 'file-inspect',
},
```

- [ ] **Step 5: Expose the preload API**

Modify `apps/desktop/src/preload/api/projectApi.ts`.

Add `inspectFile` to `ProjectApiKeys`:

```ts
| 'inspectFile'
```

Add the implementation after `runFileQA`:

```ts
inspectFile: (fileId, outputPath) =>
  ipcRenderer.invoke(IPC_CHANNELS.file.inspect, fileId, outputPath) as ReturnType<
    DesktopApi['inspectFile']
  >,
```

- [ ] **Step 6: Add temporary service surface so IPC can compile**

Modify `apps/desktop/src/main/services/modules/ProjectFileModule.ts`.

Add this import:

```ts
import type { InspectFileResult } from '@cat/localization';
```

Add this method before `runFileQA`:

```ts
public async inspectFile(_fileId: number, _outputPath: string): Promise<InspectFileResult> {
  throw new Error('File inspect is not configured.');
}
```

Modify `apps/desktop/src/main/services/ProjectService.ts`.

Add this method after `runFileQA`:

```ts
public async inspectFile(fileId: number, outputPath: string) {
  return this.projectModule.inspectFile(fileId, outputPath);
}
```

- [ ] **Step 7: Register the IPC handler**

Modify `apps/desktop/src/main/ipc/projectHandlers.ts`.

Add this handler after `IPC_CHANNELS.file.runQA`:

```ts
registerHandle({ ipcMain, projectService }, IPC_CHANNELS.file.inspect, (_event, ...args) => {
  const [fileId, outputPath] = args as [number, string];
  return projectService.inspectFile(fileId, outputPath);
});
```

No manual update is needed in `apps/desktop/src/main/ipc/handlerRegistration.test.ts`; it builds `expectedChannels` from `IPC_CHANNELS.file`, so the test will fail until this handler exists.

- [ ] **Step 8: Run contract tests and typecheck**

Run:

```bash
npx vitest run apps/desktop/src/preload/api/createDesktopApi.test.ts apps/desktop/src/main/ipc/handlerRegistration.test.ts
npm run typecheck --workspace=apps/desktop
```

Expected: PASS. The inspect method still throws when called from the service; Task 2 replaces the stub with the real implementation.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/shared/ipc.ts apps/desktop/src/shared/ipcChannels.ts apps/desktop/src/preload/api/projectApi.ts apps/desktop/src/preload/api/createDesktopApi.test.ts apps/desktop/src/main/ipc/projectHandlers.ts apps/desktop/src/main/services/ProjectService.ts apps/desktop/src/main/services/modules/ProjectFileModule.ts
git commit -m "feat: add desktop file inspect ipc contract"
```

---

### Task 2: Main-Process Inspect Runner

**Files:**
- Modify: `apps/desktop/src/main/services/modules/ProjectFileModule.ts`
- Modify: `apps/desktop/src/main/services/modules/ProjectFileModule.test.ts`
- Modify: `apps/desktop/src/main/services/ProjectService.ts`
- Create: `apps/desktop/src/main/services/ProjectService.test.ts`

- [ ] **Step 1: Add ProjectFileModule inspect mapping tests**

Modify `apps/desktop/src/main/services/modules/ProjectFileModule.test.ts`.

Add this import:

```ts
import type { InspectFileInput, InspectFileResult } from '@cat/localization';
```

Add this describe block after the existing `ProjectFileModule.createPastedSourceFile` tests:

```ts
describe('ProjectFileModule.inspectFile', () => {
  function createInspectResult(outputPath: string): InspectFileResult {
    return {
      outputPath,
      jsonOutputPath: outputPath.replace(/\.xlsx$/i, '.json'),
      summary: { total: 2, ready: 2, error: 0 },
      artifact: {
        version: 1,
        generatedAt: '2026-06-29T00:00:00.000Z',
        project: {
          id: 9,
          name: 'Inspect Project',
          srcLang: 'en',
          tgtLang: 'zh',
          projectType: 'translation',
          promptChars: 0,
        },
        inputFile: {
          inputPath: 'source.xlsx',
          sheetName: 'Sheet1',
          columns: { hasHeader: true, sourceCol: 2, targetCol: 4, contextCol: 5 },
          rows: [],
        },
        systemPrompt: {
          value: '',
          promptChars: 0,
          xlsxValue: '',
          truncated: false,
        },
        units: [],
      },
    };
  }

  it('passes stored file path, import columns, tag policy, and source-only baseline to the inspect runner', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'project-file-module-inspect-'));
    const outputPath = join(rootDir, 'demo_inspect.xlsx');
    const calls: InspectFileInput[] = [];
    const inspectFileRunner = vi.fn(async (input: InspectFileInput) => {
      calls.push(input);
      return createInspectResult(outputPath);
    });

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({
        id: 12,
        projectId: 9,
        name: 'demo.xlsx',
        importOptionsJson: JSON.stringify({
          hasHeader: true,
          sourceCol: 2,
          targetCol: 4,
          contextCol: 5,
          tagPolicy: 'none',
        }),
      }),
      getProject: vi.fn().mockReturnValue({
        id: 9,
        name: 'Inspect Project',
        srcLang: 'en',
        tgtLang: 'zh',
      }),
    } as unknown as ProjectRepository;

    const module = new ProjectFileModule(
      projectRepo,
      {} as unknown as SegmentRepository,
      {} as unknown as SpreadsheetGateway,
      rootDir,
      inspectFileRunner,
    );

    const result = await module.inspectFile(12, outputPath);

    expect(result.summary).toEqual({ total: 2, ready: 2, error: 0 });
    expect(inspectFileRunner).toHaveBeenCalledTimes(1);
    expect(calls[0]).toEqual({
      projectId: 9,
      inputPath: join(rootDir, '9', '12_demo.xlsx'),
      outputPath,
      columns: {
        hasHeader: true,
        sourceCol: 2,
        targetCol: 4,
        contextCol: 5,
      },
      options: {
        requestMode: 'window-partial',
        targetBaseline: 'ignore-current-targets',
        tagPolicy: 'none',
      },
    });

    rmSync(rootDir, { recursive: true, force: true });
  });

  it('rejects files without usable import options before running inspect', async () => {
    const projectRepo = {
      getFile: vi.fn().mockReturnValue({
        id: 12,
        projectId: 9,
        name: 'demo.xlsx',
        importOptionsJson: '{"hasHeader":true}',
      }),
      getProject: vi.fn().mockReturnValue({ id: 9 }),
    } as unknown as ProjectRepository;
    const inspectFileRunner = vi.fn();

    const module = new ProjectFileModule(
      projectRepo,
      {} as unknown as SegmentRepository,
      {} as unknown as SpreadsheetGateway,
      '/tmp',
      inspectFileRunner,
    );

    await expect(module.inspectFile(12, 'inspect.xlsx')).rejects.toThrow(
      'Inspect options not found for this file. Please re-import the file.',
    );
    expect(inspectFileRunner).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run ProjectFileModule inspect tests and confirm they fail**

Run:

```bash
npx vitest run apps/desktop/src/main/services/modules/ProjectFileModule.test.ts -t "ProjectFileModule.inspectFile"
```

Expected: FAIL because `ProjectFileModule.inspectFile` is still the temporary stub and does not accept an inspect runner.

- [ ] **Step 3: Implement ProjectFileModule inspect mapping**

Modify `apps/desktop/src/main/services/modules/ProjectFileModule.ts`.

Change the inspect import to:

```ts
import type { InspectFileInput, InspectFileResult } from '@cat/localization';
```

Add this import:

```ts
import {
  parseFileImportOptions,
  resolveImportOptionsTagPolicy,
} from '../../../shared/fileTagPolicy';
```

Add this type near the class:

```ts
export type InspectFileRunner = (input: InspectFileInput) => Promise<InspectFileResult>;
```

Update the constructor:

```ts
constructor(
  private readonly projectRepo: ProjectRepository,
  private readonly segmentRepo: SegmentRepository,
  private readonly filter: SpreadsheetGateway,
  private readonly projectsDir: string,
  private readonly inspectFileRunner?: InspectFileRunner,
) {}
```

Replace the temporary `inspectFile` method with:

```ts
public async inspectFile(fileId: number, outputPath: string): Promise<InspectFileResult> {
  if (!this.inspectFileRunner) {
    throw new Error('File inspect is not configured.');
  }

  const file = this.projectRepo.getFile(fileId);
  if (!file) {
    throw new Error('File not found');
  }

  const project = this.projectRepo.getProject(file.projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const importOptions = parseFileImportOptions(file);
  if (!isInspectImportOptions(importOptions)) {
    throw new Error('Inspect options not found for this file. Please re-import the file.');
  }

  const inputPath = join(this.projectsDir, file.projectId.toString(), `${file.id}_${file.name}`);
  const columns: InspectFileInput['columns'] = {
    hasHeader: importOptions.hasHeader,
    sourceCol: importOptions.sourceCol,
    targetCol: importOptions.targetCol,
  };
  if (typeof importOptions.contextCol === 'number') {
    columns.contextCol = importOptions.contextCol;
  }

  return this.inspectFileRunner({
    projectId: project.id,
    inputPath,
    outputPath,
    columns,
    options: {
      requestMode: 'window-partial',
      targetBaseline: 'ignore-current-targets',
      tagPolicy: resolveImportOptionsTagPolicy(importOptions),
    },
  });
}
```

Add this helper after the class:

```ts
function isInspectImportOptions(options: unknown): options is ImportOptions {
  if (!options || typeof options !== 'object') return false;
  const candidate = options as Partial<ImportOptions>;
  return (
    typeof candidate.hasHeader === 'boolean' &&
    typeof candidate.sourceCol === 'number' &&
    Number.isInteger(candidate.sourceCol) &&
    candidate.sourceCol >= 0 &&
    typeof candidate.targetCol === 'number' &&
    Number.isInteger(candidate.targetCol) &&
    candidate.targetCol >= 0 &&
    (candidate.contextCol === undefined ||
      (typeof candidate.contextCol === 'number' &&
        Number.isInteger(candidate.contextCol) &&
        candidate.contextCol >= 0))
  );
}
```

- [ ] **Step 4: Add ProjectService delegation test**

Create `apps/desktop/src/main/services/ProjectService.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it, vi } from 'vitest';
import { CATDatabase } from '@cat/db';
import { ProjectService } from './ProjectService';
import type { ProjectFileModule } from './modules/ProjectFileModule';

describe('ProjectService.inspectFile', () => {
  it('delegates to ProjectFileModule.inspectFile', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'project-service-inspect-'));
    const dbPath = join(rootDir, 'cat.db');
    const db = new CATDatabase(dbPath);
    const inspectFile = vi.fn().mockResolvedValue({
      outputPath: 'inspect.xlsx',
      jsonOutputPath: 'inspect.json',
      summary: { total: 1, ready: 1, error: 0 },
    });

    try {
      const service = new ProjectService(db, join(rootDir, 'projects'), dbPath, {
        projectModule: { inspectFile } as unknown as ProjectFileModule,
        tmModule: {} as never,
        tbModule: {} as never,
        aiModule: { applySavedProxySettings: vi.fn() } as never,
      });

      const result = await service.inspectFile(44, 'inspect.xlsx');

      expect(inspectFile).toHaveBeenCalledWith(44, 'inspect.xlsx');
      expect(result.summary.ready).toBe(1);
    } finally {
      db.close();
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 5: Wire LocalizationInspector into ProjectService**

Modify `apps/desktop/src/main/services/ProjectService.ts`.

Update the localization import:

```ts
import {
  LocalizationEngine,
  LocalizationInspector,
  type TranslationAuditSink,
} from '@cat/localization';
```

Update the ProjectFileModule import:

```ts
import { ProjectFileModule, type InspectFileRunner } from './modules/ProjectFileModule';
```

Add this dependency field to `ProjectServiceDependencies`:

```ts
inspectFileRunner?: InspectFileRunner;
```

Before constructing `ProjectFileModule`, create the runner:

```ts
const inspectFileRunner =
  deps.inspectFileRunner ?? createInspectFileRunner(db, dbPath, aiRuntimeConfigProvider);
```

Pass it into `ProjectFileModule`:

```ts
this.projectModule =
  deps.projectModule ??
  new ProjectFileModule(projectRepo, segmentRepo, filter, projectsDir, inspectFileRunner);
```

Add this helper after the class:

```ts
function createInspectFileRunner(
  db: CATDatabase,
  dbPath: string,
  aiRuntimeConfigProvider?: AIRuntimeConfigProvider,
): InspectFileRunner {
  const inspector = new LocalizationInspector(db, {
    dbPath,
    aiRuntimeConfigProvider,
  });

  return (input) => inspector.inspectFile(input);
}
```

- [ ] **Step 6: Run main-process tests and typecheck**

Run:

```bash
npx vitest run apps/desktop/src/main/services/modules/ProjectFileModule.test.ts -t "ProjectFileModule.inspectFile"
npx vitest run apps/desktop/src/main/services/ProjectService.test.ts
npm run typecheck --workspace=apps/desktop
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/services/modules/ProjectFileModule.ts apps/desktop/src/main/services/modules/ProjectFileModule.test.ts apps/desktop/src/main/services/ProjectService.ts apps/desktop/src/main/services/ProjectService.test.ts
git commit -m "feat: run shared inspect for desktop files"
```

---

### Task 3: Renderer File Action

**Files:**
- Create: `apps/desktop/src/renderer/src/components/project-detail/fileInspectAction.ts`
- Create: `apps/desktop/src/renderer/src/components/project-detail/fileInspectAction.test.ts`
- Modify: `apps/desktop/src/renderer/src/components/project-detail/ProjectFilesPane.tsx`
- Modify: `apps/desktop/src/renderer/src/components/project-detail/ProjectFilesPane.test.ts`
- Modify: `apps/desktop/src/renderer/src/components/project-detail/ProjectFilesPane.wiring.test.ts`
- Modify: `apps/desktop/src/renderer/src/components/ProjectDetail.tsx`

- [ ] **Step 1: Write renderer action helper tests**

Create `apps/desktop/src/renderer/src/components/project-detail/fileInspectAction.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { ProjectFileRecord } from '../../../../shared/ipc';
import {
  buildInspectDefaultPath,
  INSPECT_OUTPUT_FILTERS,
  runFileInspectAction,
} from './fileInspectAction';

function createFile(overrides?: Partial<ProjectFileRecord>): ProjectFileRecord {
  return {
    id: 7,
    uuid: 'file-7',
    projectId: 22,
    name: 'demo.xlsx',
    totalSegments: 2,
    confirmedSegments: 0,
    importOptionsJson: null,
    segmentStatusStats: {
      totalSegments: 2,
      qaProblemSegments: 0,
      confirmedSegmentsForBar: 0,
      inProgressSegments: 0,
      newSegments: 2,
    },
    createdAt: '2026-06-29T00:00:00.000Z',
    updatedAt: '2026-06-29T00:00:00.000Z',
    ...overrides,
  };
}

describe('fileInspectAction', () => {
  it('builds xlsx inspect defaults from the original file name', () => {
    expect(buildInspectDefaultPath('demo.xlsx')).toBe('demo_inspect.xlsx');
    expect(buildInspectDefaultPath('demo.csv')).toBe('demo_inspect.xlsx');
    expect(buildInspectDefaultPath('demo')).toBe('demo_inspect.xlsx');
  });

  it('runs inspect after save path selection and reports summary', async () => {
    const saveFileDialog = vi.fn().mockResolvedValue('D:/out/demo_inspect.xlsx');
    const inspectFile = vi.fn().mockResolvedValue({
      outputPath: 'D:/out/demo_inspect.xlsx',
      jsonOutputPath: 'D:/out/demo_inspect.json',
      summary: { total: 3, ready: 2, error: 1 },
    });
    const runMutation = vi.fn(async (fn: () => Promise<unknown>) => fn());
    const success = vi.fn();
    const error = vi.fn();

    const result = await runFileInspectAction(createFile(), {
      saveFileDialog,
      inspectFile,
      runMutation,
      success,
      error,
    });

    expect(saveFileDialog).toHaveBeenCalledWith('demo_inspect.xlsx', INSPECT_OUTPUT_FILTERS);
    expect(inspectFile).toHaveBeenCalledWith(7, 'D:/out/demo_inspect.xlsx');
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith('Inspect exported: 2/3 source rows ready.');
    expect(error).not.toHaveBeenCalled();
    expect(result?.jsonOutputPath).toBe('D:/out/demo_inspect.json');
  });

  it('does nothing when the save dialog is cancelled', async () => {
    const inspectFile = vi.fn();

    const result = await runFileInspectAction(createFile(), {
      saveFileDialog: vi.fn().mockResolvedValue(null),
      inspectFile,
      runMutation: vi.fn(async (fn: () => Promise<unknown>) => fn()),
      success: vi.fn(),
      error: vi.fn(),
    });

    expect(result).toBeNull();
    expect(inspectFile).not.toHaveBeenCalled();
  });

  it('reports inspect failures', async () => {
    const error = vi.fn();

    await runFileInspectAction(createFile(), {
      saveFileDialog: vi.fn().mockResolvedValue('D:/out/demo_inspect.xlsx'),
      inspectFile: vi.fn().mockRejectedValue(new Error('inspect blew up')),
      runMutation: vi.fn(async (fn: () => Promise<unknown>) => fn()),
      success: vi.fn(),
      error,
    });

    expect(error).toHaveBeenCalledWith('Inspect failed: inspect blew up');
  });
});
```

- [ ] **Step 2: Run renderer action helper test and confirm it fails**

Run:

```bash
npx vitest run apps/desktop/src/renderer/src/components/project-detail/fileInspectAction.test.ts
```

Expected: FAIL because `fileInspectAction.ts` does not exist.

- [ ] **Step 3: Implement renderer action helper**

Create `apps/desktop/src/renderer/src/components/project-detail/fileInspectAction.ts`:

```ts
import type { DesktopApi, DialogFileFilter, FileInspectResult, ProjectFileRecord } from '../../../../shared/ipc';

export const INSPECT_OUTPUT_FILTERS: DialogFileFilter[] = [
  { name: 'Excel Workbook', extensions: ['xlsx'] },
];

export function buildInspectDefaultPath(fileName: string): string {
  const baseName = fileName.replace(/\.[^/.\\]+$/u, '') || fileName;
  return `${baseName}_inspect.xlsx`;
}

export interface RunFileInspectActionDeps {
  saveFileDialog: DesktopApi['saveFileDialog'];
  inspectFile: DesktopApi['inspectFile'];
  runMutation: <T>(fn: () => Promise<T>) => Promise<T>;
  success: (message: string) => void;
  error: (message: string) => void;
}

export async function runFileInspectAction(
  file: ProjectFileRecord,
  deps: RunFileInspectActionDeps,
): Promise<FileInspectResult | null> {
  const outputPath = await deps.saveFileDialog(
    buildInspectDefaultPath(file.name),
    INSPECT_OUTPUT_FILTERS,
  );
  if (!outputPath) return null;

  try {
    const result = await deps.runMutation(() => deps.inspectFile(file.id, outputPath));
    deps.success(
      `Inspect exported: ${result.summary.ready}/${result.summary.total} source rows ready.`,
    );
    return result;
  } catch (caught) {
    deps.error(`Inspect failed: ${caught instanceof Error ? caught.message : String(caught)}`);
    return null;
  }
}
```

- [ ] **Step 4: Add the Inspect button to the file pane**

Modify `apps/desktop/src/renderer/src/components/project-detail/ProjectFilesPane.tsx`.

Add `onInspectFile` to `ProjectFilesPaneProps`:

```ts
onInspectFile: (file: ProjectFileRecord) => void | Promise<void>;
```

Add it to `ProjectFileCardProps`, destructuring, and the card call.

Render the button inside the `supportsTMWorkflow` action group, after `TM Match`:

```tsx
{supportsTMWorkflow && (
  <Button
    onClick={() => void onInspectFile(file)}
    variant="soft"
    size="sm"
    className="!bg-info-soft !text-info"
  >
    Inspect
  </Button>
)}
```

- [ ] **Step 5: Update ProjectFilesPane tests**

Modify every `ProjectFilesPane` render setup in:

- `apps/desktop/src/renderer/src/components/project-detail/ProjectFilesPane.test.ts`
- `apps/desktop/src/renderer/src/components/project-detail/ProjectFilesPane.wiring.test.ts`

Add:

```ts
onInspectFile: vi.fn().mockResolvedValue(undefined),
```

In `ProjectFilesPane.test.ts`, add this assertion to `shows a single AI Translate button in translation projects`:

```ts
expect(html).toContain('Inspect');
```

Add this assertion to `keeps one-click AI action for non-translation projects`:

```ts
expect(html).not.toContain('Inspect');
```

- [ ] **Step 6: Wire ProjectDetail to the action helper**

Modify `apps/desktop/src/renderer/src/components/ProjectDetail.tsx`.

Add import:

```ts
import { runFileInspectAction } from './project-detail/fileInspectAction';
```

Add this handler near `handleExportFile`:

```ts
const handleInspectFile = async (file: ProjectFileRecord) => {
  await runFileInspectAction(file, {
    saveFileDialog: apiClient.saveFileDialog,
    inspectFile: apiClient.inspectFile,
    runMutation,
    success: (message) => feedbackService.success(message),
    error: (message) => feedbackService.error(message),
  });
};
```

Pass it into `ProjectFilesPane`:

```tsx
onInspectFile={handleInspectFile}
```

- [ ] **Step 7: Run renderer tests and typecheck**

Run:

```bash
npx vitest run apps/desktop/src/renderer/src/components/project-detail/fileInspectAction.test.ts apps/desktop/src/renderer/src/components/project-detail/ProjectFilesPane.test.ts apps/desktop/src/renderer/src/components/project-detail/ProjectFilesPane.wiring.test.ts
npm run typecheck --workspace=apps/desktop
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/src/components/project-detail/fileInspectAction.ts apps/desktop/src/renderer/src/components/project-detail/fileInspectAction.test.ts apps/desktop/src/renderer/src/components/project-detail/ProjectFilesPane.tsx apps/desktop/src/renderer/src/components/project-detail/ProjectFilesPane.test.ts apps/desktop/src/renderer/src/components/project-detail/ProjectFilesPane.wiring.test.ts apps/desktop/src/renderer/src/components/ProjectDetail.tsx
git commit -m "feat: add desktop file inspect action"
```

---

### Task 4: Verification And Cleanup

**Files:**
- No planned source files beyond fixes required by verification.

- [ ] **Step 1: Run focused inspect-related tests**

Run:

```bash
npx vitest run apps/desktop/src/preload/api/createDesktopApi.test.ts apps/desktop/src/main/ipc/handlerRegistration.test.ts
npx vitest run apps/desktop/src/main/services/modules/ProjectFileModule.test.ts -t "ProjectFileModule.inspectFile"
npx vitest run apps/desktop/src/main/services/ProjectService.test.ts apps/desktop/src/renderer/src/components/project-detail/fileInspectAction.test.ts apps/desktop/src/renderer/src/components/project-detail/ProjectFilesPane.test.ts apps/desktop/src/renderer/src/components/project-detail/ProjectFilesPane.wiring.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run desktop typecheck**

Run:

```bash
npm run typecheck --workspace=apps/desktop
```

Expected: PASS.

- [ ] **Step 3: Run architecture and style gates that cover the touched desktop boundary**

Run:

```bash
npm run gate:arch
npm run gate:style
npm run gate:file-size
```

Expected: PASS.

- [ ] **Step 4: Run the full gate if focused checks are clean**

Run:

```bash
npm run gate:check
```

Expected: PASS.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git diff --check
git status --short --untracked-files=all
```

Expected: `git diff --check` emits no output. `git status` lists only the intended inspect implementation files if the work has not been committed task-by-task.

- [ ] **Step 6: Final commit if earlier task commits were skipped**

If Tasks 1-3 were committed individually, skip this step.

If the work was implemented as one batch, run:

```bash
git add apps/desktop/src/shared/ipc.ts apps/desktop/src/shared/ipcChannels.ts apps/desktop/src/preload/api/projectApi.ts apps/desktop/src/preload/api/createDesktopApi.test.ts apps/desktop/src/main/ipc/projectHandlers.ts apps/desktop/src/main/services/ProjectService.ts apps/desktop/src/main/services/ProjectService.test.ts apps/desktop/src/main/services/modules/ProjectFileModule.ts apps/desktop/src/main/services/modules/ProjectFileModule.test.ts apps/desktop/src/renderer/src/components/project-detail/fileInspectAction.ts apps/desktop/src/renderer/src/components/project-detail/fileInspectAction.test.ts apps/desktop/src/renderer/src/components/project-detail/ProjectFilesPane.tsx apps/desktop/src/renderer/src/components/project-detail/ProjectFilesPane.test.ts apps/desktop/src/renderer/src/components/project-detail/ProjectFilesPane.wiring.test.ts apps/desktop/src/renderer/src/components/ProjectDetail.tsx
git commit -m "feat: add desktop file inspect action"
```

---

## Self-Review

- Spec coverage:
  - Desktop file-card `Inspect` action: Task 3.
  - Save `.xlsx` output path: Task 3.
  - JSON sidecar matching CLI behavior: Task 2 returns the shared inspector result, whose default JSON sidecar behavior is owned by `LocalizationInspector`.
  - Thin preload and IPC bridge: Task 1.
  - Main process file lookup and stored path resolution: Task 2.
  - Import columns and file `tagPolicy`: Task 2.
  - `requestMode: 'window-partial'`: Task 2.
  - `targetBaseline: 'ignore-current-targets'`: Task 2.
  - No provider requests or desktop TM/TB duplication: Task 2 uses `LocalizationInspector` directly.
  - Existing actions remain wired: Task 3 updates existing file-pane tests and preserves existing props.
- Placeholder scan:
  - No unspecified tasks, deferred implementation notes, or open requirements remain in the plan.
- Type consistency:
  - `FileInspectResult` is the renderer/preload-safe subset of `InspectFileResult`.
  - `InspectFileRunner` accepts `InspectFileInput` and returns `InspectFileResult`.
  - `ProjectService.inspectFile`, `ProjectFileModule.inspectFile`, and `DesktopApi.inspectFile` all use `(fileId: number, outputPath: string)`.
  - Renderer code passes the full `ProjectFileRecord` only inside the renderer helper; IPC only receives `fileId` and `outputPath`.
