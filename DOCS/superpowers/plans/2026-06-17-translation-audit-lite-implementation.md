# Translation Audit Lite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight JSONL audit trail that can confirm whether desktop and CLI file translation sent a single-segment repair request after a batch tag validation failure.

**Architecture:** Add an optional no-op-by-default audit sink to `packages/localization`, thread it through the existing job runner, window strategies, and MT module, then expose it through CLI `--audit` and desktop debug environment variables. The first useful report is intentionally tiny: request type, unit mapping, tag-invalid events, repair request/success/failure, unit persistence, and runtime TM commit.

**Tech Stack:** TypeScript, Vitest, Node `fs/promises`, existing localization job runner and desktop main-process services.

---

## Scope Note

This is a lightweight audit, not a full request logger. Do not record full system prompts, user prompts, provider responses, full source text, or full target text. The initial debugging question is:

```text
Did desktop send a single-segment repair request for this file translation run?
```

The minimum positive proof is an audit line with:

```json
{"event":"mt_repair_request","unit":"row-20","rid":"r4","reason":"tag_invalid"}
```

The minimum negative proof is a run with `mt_batch_request` and `mt_batch_response` lines but no `mt_repair_request` lines.

## File Structure

- Create `packages/localization/src/audit/TranslationAudit.ts`
  - Owns audit event types, no-op sink, in-memory test sink, JSONL file sink, and target hashing helpers.
- Modify `packages/localization/src/index.ts`
  - Exports audit types and sink helpers for CLI and desktop.
- Modify `packages/localization/src/job/types.ts`
  - Adds optional audit sink to `TaskExecutionContext`.
- Modify `packages/localization/src/job/TranslationJobRunner.ts`
  - Passes audit sink to task executors.
  - Emits `unit_persisted` after host apply plus checkpoint persistence.
  - Emits `runtime_tm_commit` after runtime TM commit succeeds.
- Modify `packages/localization/src/modules/MTModuleTypes.ts`
  - Adds `rowNumber` to batch units.
  - Adds optional audit context to prepared batch prompts.
- Modify `packages/localization/src/modules/MTModule.ts`
  - Emits batch request/response, tag invalid, repair request/success/failure, and batch error events.
- Modify `packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.ts`
- Modify `packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.ts`
  - Pass job id, row number, and audit sink into `MTModule.translateBatch`.
- Modify `packages/localization/src/fileTranslationJobAdapter.ts`
- Modify `packages/localization/src/projectSegmentJobAdapter.ts`
- Modify `packages/localization/src/LocalizationEngine.ts`
  - Accept and propagate `auditSink`.
- Modify `packages/localization/src/cli/translateFileCommand.ts`
- Modify `apps/cli/src/commands/translateFileCommand.ts`
  - Add CLI `--audit <path>`.
- Create `apps/desktop/src/main/services/modules/ai/translationAuditDebug.ts`
- Modify `apps/desktop/src/main/index.ts`
- Modify `apps/desktop/src/main/services/ProjectService.ts`
  - Enable desktop audit only through environment flags.
- Tests:
  - Create `packages/localization/src/audit/TranslationAudit.test.ts`.
  - Modify `packages/localization/src/job/TranslationJobRunner.test.ts`.
  - Modify `packages/localization/src/modules/MTModule.test.ts`.
  - Modify `apps/cli/src/cli.test.ts`.
  - Create `apps/desktop/src/main/services/modules/ai/translationAuditDebug.test.ts`.

---

### Task 1: Add The Audit Sink

**Files:**
- Create: `packages/localization/src/audit/TranslationAudit.ts`
- Create: `packages/localization/src/audit/TranslationAudit.test.ts`
- Modify: `packages/localization/src/index.ts`

- [ ] **Step 1: Write the failing audit sink tests**

Create `packages/localization/src/audit/TranslationAudit.test.ts`:

```ts
import { mkdtemp, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  JsonlTranslationAuditSink,
  createMemoryTranslationAuditSink,
  noopTranslationAuditSink,
  summarizeAuditText,
} from './TranslationAudit';

describe('TranslationAudit', () => {
  it('keeps the no-op sink callable', () => {
    expect(() =>
      noopTranslationAuditSink.record({
        event: 'mt_repair_request',
        job: 'job-1',
        task: 'task-1',
        unit: 'row-20',
        rid: 'r4',
        reason: 'tag_invalid',
      }),
    ).not.toThrow();
  });

  it('records events in memory for unit tests', () => {
    const sink = createMemoryTranslationAuditSink();

    sink.record({
      event: 'mt_batch_request',
      job: 'job-1',
      task: 'task-1',
      mode: 'window-partial',
      units: [{ doc: 'doc.xlsx', unit: 'row-20', rid: 'r4', row: 20 }],
    });

    expect(sink.events).toEqual([
      {
        event: 'mt_batch_request',
        job: 'job-1',
        task: 'task-1',
        mode: 'window-partial',
        units: [{ doc: 'doc.xlsx', unit: 'row-20', rid: 'r4', row: 20 }],
      },
    ]);
  });

  it('writes JSONL records without awaiting record calls', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'momocat-audit-'));
    const filePath = join(dir, 'audit.jsonl');
    const sink = new JsonlTranslationAuditSink(filePath, {
      now: () => new Date('2026-06-17T00:00:00.000Z'),
    });

    sink.record({
      event: 'mt_repair_success',
      job: 'job-1',
      task: 'task-1',
      unit: 'row-20',
      rid: 'r4',
      targetHash: 'abcdef123456',
      targetChars: 96,
    });
    await sink.flush();

    expect(await readFile(filePath, 'utf8')).toBe(
      `${JSON.stringify({
        at: '2026-06-17T00:00:00.000Z',
        event: 'mt_repair_success',
        job: 'job-1',
        task: 'task-1',
        unit: 'row-20',
        rid: 'r4',
        targetHash: 'abcdef123456',
        targetChars: 96,
      })}\n`,
    );
  });

  it('summarizes text with hash and character count only', () => {
    expect(summarizeAuditText('Bonjour {1}')).toEqual({
      targetHash: expect.stringMatching(/^[a-f0-9]{12}$/),
      targetChars: 11,
    });
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```powershell
npx vitest run packages/localization/src/audit/TranslationAudit.test.ts
```

Expected: FAIL because `packages/localization/src/audit/TranslationAudit.ts` does not exist.

- [ ] **Step 3: Add the audit implementation**

Create `packages/localization/src/audit/TranslationAudit.ts`:

```ts
import { createHash } from 'crypto';
import { mkdir, appendFile } from 'fs/promises';
import { dirname } from 'path';

export type TranslationAuditEvent =
  | TranslationAuditBatchRequestEvent
  | TranslationAuditBatchResponseEvent
  | TranslationAuditBatchErrorEvent
  | TranslationAuditTagInvalidEvent
  | TranslationAuditRepairRequestEvent
  | TranslationAuditRepairSuccessEvent
  | TranslationAuditRepairFailedEvent
  | TranslationAuditUnitPersistedEvent
  | TranslationAuditRuntimeTmCommitEvent;

interface TranslationAuditBaseEvent {
  event: string;
  job: string;
  task?: string;
}

export interface TranslationAuditUnitRef {
  doc: string;
  unit: string;
  rid?: string;
  row?: number;
}

export interface TranslationAuditBatchRequestEvent extends TranslationAuditBaseEvent {
  event: 'mt_batch_request';
  task: string;
  mode: 'window' | 'window-partial';
  units: TranslationAuditUnitRef[];
}

export interface TranslationAuditBatchResponseEvent extends TranslationAuditBaseEvent {
  event: 'mt_batch_response';
  task: string;
  latencyMs: number;
  returnedIds: string[];
}

export interface TranslationAuditBatchErrorEvent extends TranslationAuditBaseEvent {
  event: 'mt_batch_error';
  task: string;
  latencyMs: number;
  message: string;
}

export interface TranslationAuditTagInvalidEvent extends TranslationAuditBaseEvent {
  event: 'mt_tag_invalid';
  task: string;
  unit: string;
  rid: string;
  messages: string[];
  targetHash: string;
  targetChars: number;
}

export interface TranslationAuditRepairRequestEvent extends TranslationAuditBaseEvent {
  event: 'mt_repair_request';
  task: string;
  unit: string;
  rid: string;
  reason: 'tag_invalid';
}

export interface TranslationAuditRepairSuccessEvent extends TranslationAuditBaseEvent {
  event: 'mt_repair_success';
  task: string;
  unit: string;
  rid: string;
  targetHash: string;
  targetChars: number;
}

export interface TranslationAuditRepairFailedEvent extends TranslationAuditBaseEvent {
  event: 'mt_repair_failed';
  task: string;
  unit: string;
  rid: string;
  message: string;
}

export interface TranslationAuditUnitPersistedEvent extends TranslationAuditBaseEvent {
  event: 'unit_persisted';
  task: string;
  doc: string;
  unit: string;
  status: 'translated' | 'skipped' | 'reused' | 'failed';
  attempts: number;
  targetHash?: string;
  targetChars?: number;
}

export interface TranslationAuditRuntimeTmCommitEvent extends TranslationAuditBaseEvent {
  event: 'runtime_tm_commit';
  task: string;
  units: string[];
}

export interface TranslationAuditSink {
  record(event: TranslationAuditEvent): void;
  flush?(): Promise<void>;
}

export interface TranslationAuditContext {
  jobId: string;
  sink: TranslationAuditSink;
}

export const noopTranslationAuditSink: TranslationAuditSink = {
  record: () => undefined,
};

export function createMemoryTranslationAuditSink(): TranslationAuditSink & {
  events: TranslationAuditEvent[];
} {
  const events: TranslationAuditEvent[] = [];
  return {
    events,
    record: (event) => {
      events.push(event);
    },
  };
}

export interface JsonlTranslationAuditSinkOptions {
  now?: () => Date;
  onError?: (error: unknown) => void;
}

export class JsonlTranslationAuditSink implements TranslationAuditSink {
  private writeQueue: Promise<void>;
  private disabled = false;
  private readonly now: () => Date;
  private readonly onError: (error: unknown) => void;

  constructor(
    private readonly filePath: string,
    options: JsonlTranslationAuditSinkOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.onError =
      options.onError ??
      ((error) => {
        console.error('[TranslationAudit] Failed to append audit record:', error);
      });
    this.writeQueue = mkdir(dirname(filePath), { recursive: true });
  }

  record(event: TranslationAuditEvent): void {
    if (this.disabled) {
      return;
    }

    const line = `${JSON.stringify({
      at: this.now().toISOString(),
      ...event,
    })}\n`;

    this.writeQueue = this.writeQueue
      .then(() => appendFile(this.filePath, line, 'utf8'))
      .catch((error) => {
        this.disabled = true;
        this.onError(error);
      });
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }
}

export function summarizeAuditText(
  value: string | undefined,
): { targetHash: string; targetChars: number } | undefined {
  if (value === undefined) {
    return undefined;
  }

  return {
    targetHash: createHash('sha256').update(value).digest('hex').slice(0, 12),
    targetChars: value.length,
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 4: Export audit APIs**

Modify `packages/localization/src/index.ts` and add:

```ts
export type {
  TranslationAuditContext,
  TranslationAuditEvent,
  TranslationAuditSink,
  TranslationAuditUnitRef,
} from './audit/TranslationAudit';
export {
  JsonlTranslationAuditSink,
  createMemoryTranslationAuditSink,
  noopTranslationAuditSink,
  summarizeAuditText,
} from './audit/TranslationAudit';
```

- [ ] **Step 5: Run the audit test**

Run:

```powershell
npx vitest run packages/localization/src/audit/TranslationAudit.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```powershell
git add packages/localization/src/audit/TranslationAudit.ts packages/localization/src/audit/TranslationAudit.test.ts packages/localization/src/index.ts
git commit -m "feat: add translation audit sink"
```

---

### Task 2: Thread Audit Through The Job Runner

**Files:**
- Modify: `packages/localization/src/job/types.ts`
- Modify: `packages/localization/src/job/TranslationJobRunner.ts`
- Modify: `packages/localization/src/job/TranslationJobRunner.test.ts`

- [ ] **Step 1: Write failing job runner tests**

Add imports in `packages/localization/src/job/TranslationJobRunner.test.ts`:

```ts
import { createMemoryTranslationAuditSink } from '../audit/TranslationAudit';
```

Add this test near the existing runtime TM tests:

```ts
  it('passes audit sink to task executors and records persisted units plus runtime TM commits', async () => {
    const harness = await makeHarness();
    const auditSink = createMemoryTranslationAuditSink();
    const commit = vi.fn();
    const executor = vi.fn<TranslationTaskExecutor>(async (task, context) => {
      expect(context.auditSink).toBe(auditSink);
      return {
        results: [
          makeResult({
            unitId: task.units[0].unitId,
            sourceHash: task.units[0].sourceHash,
            source: task.units[0].source,
            target: 'Bonjour',
            attempts: context.attempt,
          }),
        ],
      };
    });
    const runner = harness.makeRunner(executor, {
      auditSink,
      runtimeTm: {
        seed: vi.fn(),
        commit,
      },
    });

    await runner.run(makeJob());

    expect(commit).toHaveBeenCalledTimes(1);
    expect(auditSink.events.map((event) => event.event)).toEqual([
      'unit_persisted',
      'runtime_tm_commit',
    ]);
    expect(auditSink.events[0]).toMatchObject({
      event: 'unit_persisted',
      job: 'job-1',
      task: 'task-1',
      doc: 'doc-1',
      unit: 'unit-1',
      status: 'translated',
      attempts: 1,
      targetChars: 7,
    });
    expect(auditSink.events[1]).toMatchObject({
      event: 'runtime_tm_commit',
      job: 'job-1',
      task: 'task-1',
      units: ['unit-1'],
    });
  });
```

Extend the `makeRunner` options type in the same test file with `auditSink`:

```ts
      | 'auditSink'
```

and pass it into dependencies:

```ts
        auditSink: options.auditSink,
```

- [ ] **Step 2: Run the failing job runner test**

Run:

```powershell
npx vitest run packages/localization/src/job/TranslationJobRunner.test.ts -t "passes audit sink"
```

Expected: FAIL because `auditSink` is not part of runner dependencies or task context.

- [ ] **Step 3: Add audit to task context types**

Modify `packages/localization/src/job/types.ts`:

```ts
import type { TranslationAuditSink } from '../audit/TranslationAudit';
```

Add to `TaskExecutionContext`:

```ts
  auditSink?: TranslationAuditSink;
```

- [ ] **Step 4: Add audit to runner dependencies and constructor**

Modify `packages/localization/src/job/TranslationJobRunner.ts`.

Add imports:

```ts
import {
  summarizeAuditText,
  type TranslationAuditSink,
} from '../audit/TranslationAudit';
```

Add to `TranslationJobRunnerDependencies`:

```ts
  auditSink?: TranslationAuditSink;
```

Add a private member:

```ts
  private readonly auditSink?: TranslationAuditSink;
```

Set it in the constructor:

```ts
    this.auditSink = dependencies.auditSink;
```

- [ ] **Step 5: Pass audit sink into task execution**

In `executeTaskWithAttempts`, update the task executor context:

```ts
        const result = await this.taskExecutor(task, {
          job,
          attempt,
          captureArtifacts: Boolean(this.artifactStore),
          completedResults,
          auditSink: this.auditSink,
        });
```

- [ ] **Step 6: Record persisted unit audit events**

In `persistTaskResult`, after `await this.checkpointStore.append(checkpoint);` and before the existing `resultMap.set(unitKeyFromParts(result.documentId, result.unitId), result);` call, record:

```ts
        const targetSummary = summarizeAuditText(result.target);
        this.auditSink?.record({
          event: 'unit_persisted',
          job: job.id,
          task: task.taskId,
          doc: result.documentId,
          unit: result.unitId,
          status: result.status,
          attempts: result.attempts ?? 1,
          ...(targetSummary ?? {}),
        });
```

Keep this inside the `if (checkpoint)` block so failed host apply or failed checkpoint append produces no `unit_persisted` event.

- [ ] **Step 7: Record runtime TM commit audit events**

In `run`, replace this block inside `enqueuePersistence`:

```ts
          await this.persistTaskResult(job, task, taskResult, resultMap, throttle);
          await this.runtimeTm?.commit(taskResult.results, task, job);
```

with:

```ts
          await this.persistTaskResult(job, task, taskResult, resultMap, throttle);
          await this.runtimeTm?.commit(taskResult.results, task, job);
          if (this.runtimeTm) {
            this.auditSink?.record({
              event: 'runtime_tm_commit',
              job: job.id,
              task: task.taskId,
              units: taskResult.results.map((result) => result.unitId),
            });
          }
```

- [ ] **Step 8: Run the job runner test**

Run:

```powershell
npx vitest run packages/localization/src/job/TranslationJobRunner.test.ts -t "passes audit sink"
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

Run:

```powershell
git add packages/localization/src/job/types.ts packages/localization/src/job/TranslationJobRunner.ts packages/localization/src/job/TranslationJobRunner.test.ts
git commit -m "feat: audit job persistence flow"
```

---

### Task 3: Emit MT Batch And Single-Repair Audit Events

**Files:**
- Modify: `packages/localization/src/modules/MTModuleTypes.ts`
- Modify: `packages/localization/src/modules/MTModule.ts`
- Modify: `packages/localization/src/modules/MTModule.test.ts`

- [ ] **Step 1: Write failing MT audit tests**

Add import in `packages/localization/src/modules/MTModule.test.ts`:

```ts
import { createMemoryTranslationAuditSink } from '../audit/TranslationAudit';
```

In the existing test `repairs only the invalid Window Mode unit with a single-segment prompt`, add:

```ts
      const auditSink = createMemoryTranslationAuditSink();
```

Add this property to the `module.translateBatch` input:

```ts
        audit: {
          jobId: 'job-1',
          sink: auditSink,
        },
```

After the existing assertions, add:

```ts
      expect(auditSink.events.map((event) => event.event)).toEqual([
        'mt_batch_request',
        'mt_batch_response',
        'mt_tag_invalid',
        'mt_repair_request',
        'mt_repair_success',
      ]);
      expect(auditSink.events[0]).toMatchObject({
        event: 'mt_batch_request',
        job: 'job-1',
        task: 'window-task-1',
        mode: 'window',
        units: [
          { doc: 'doc.xlsx', unit: 'unit-2', rid: 'r1' },
          { doc: 'doc.xlsx', unit: 'unit-3', rid: 'r2' },
        ],
      });
      expect(auditSink.events[2]).toMatchObject({
        event: 'mt_tag_invalid',
        job: 'job-1',
        task: 'window-task-1',
        unit: 'unit-2',
        rid: 'r1',
        messages: ['Missing tags: {1}'],
      });
      expect(auditSink.events[3]).toMatchObject({
        event: 'mt_repair_request',
        job: 'job-1',
        task: 'window-task-1',
        unit: 'unit-2',
        rid: 'r1',
        reason: 'tag_invalid',
      });
      expect(auditSink.events[4]).toMatchObject({
        event: 'mt_repair_success',
        job: 'job-1',
        task: 'window-task-1',
        unit: 'unit-2',
        rid: 'r1',
        targetChars: 15,
      });
```

In the existing test `rejects when single-segment repair cannot fix an invalid Window Mode unit`, add a memory sink to the input and assert:

```ts
      expect(auditSink.events.map((event) => event.event)).toContain('mt_repair_failed');
      expect(auditSink.events.find((event) => event.event === 'mt_repair_failed')).toMatchObject({
        event: 'mt_repair_failed',
        job: 'job-1',
        task: 'window-task-1',
        unit: 'unit-2',
        rid: 'r1',
      });
```

- [ ] **Step 2: Run the failing MT tests**

Run:

```powershell
npx vitest run packages/localization/src/modules/MTModule.test.ts -t "repairs only the invalid Window Mode unit|rejects when single-segment repair"
```

Expected: FAIL because `audit` is not accepted and no audit events are recorded.

- [ ] **Step 3: Add audit metadata to MT types**

Modify `packages/localization/src/modules/MTModuleTypes.ts`:

```ts
import type { TranslationAuditContext } from '../audit/TranslationAudit';
```

Add to `MTBatchCurrentUnitInput`:

```ts
  rowNumber?: number;
```

Add to `PreparedBatchPromptInput`:

```ts
  audit?: TranslationAuditContext;
```

`TranslatePreparedBatchPromptInput` extends `PreparedBatchPromptInput`, so no additional field is needed there.

- [ ] **Step 4: Add audit helpers in MTModule**

Modify `packages/localization/src/modules/MTModule.ts`.

Add imports:

```ts
import {
  errorMessage,
  summarizeAuditText,
  type TranslationAuditContext,
} from '../audit/TranslationAudit';
```

Add a private helper to `MTModule`:

```ts
  private recordAudit(
    audit: TranslationAuditContext | undefined,
    event: Parameters<TranslationAuditContext['sink']['record']>[0],
  ): void {
    audit?.sink.record(event);
  }
```

- [ ] **Step 5: Record batch request, response, and error**

At the top of `translateBatch`, after `tagPolicy` is resolved, add:

```ts
    const startedAt = Date.now();
    this.recordAudit(input.audit, {
      event: 'mt_batch_request',
      job: input.audit?.jobId ?? '',
      task: input.taskId,
      mode: input.requestMode === 'window-partial' ? 'window-partial' : 'window',
      units: input.current.map((unit) => ({
        doc: unit.documentId,
        unit: unit.unitId,
        rid: unit.responseId,
        ...(typeof unit.rowNumber === 'number' ? { row: unit.rowNumber } : {}),
      })),
    });
```

Because `recordAudit` should not emit without an audit context, guard this call:

```ts
    if (input.audit) {
      this.recordAudit(input.audit, {
        event: 'mt_batch_request',
        job: input.audit.jobId,
        task: input.taskId,
        mode: input.requestMode === 'window-partial' ? 'window-partial' : 'window',
        units: input.current.map((unit) => ({
          doc: unit.documentId,
          unit: unit.unitId,
          rid: unit.responseId,
          ...(typeof unit.rowNumber === 'number' ? { row: unit.rowNumber } : {}),
        })),
      });
    }
```

Wrap provider request, parse, and result construction in a `try/catch`. The successful path should record:

```ts
    if (input.audit) {
      this.recordAudit(input.audit, {
        event: 'mt_batch_response',
        job: input.audit.jobId,
        task: input.taskId,
        latencyMs: Date.now() - startedAt,
        returnedIds: translations.map((translation) => translation.id),
      });
    }
```

The catch block should record and rethrow:

```ts
    if (input.audit) {
      this.recordAudit(input.audit, {
        event: 'mt_batch_error',
        job: input.audit.jobId,
        task: input.taskId,
        latencyMs: Date.now() - startedAt,
        message: errorMessage(error),
      });
    }
    throw error;
```

- [ ] **Step 6: Record tag invalid and repair events**

When building `invalidResults`, keep `validationMessages` as already implemented. Before calling `repairInvalidBatchResult`, add:

```ts
      const invalidTargetText = serializeTokensToDisplayText(
        invalidResult.parsedResult.targetTokens,
      );
      const invalidTargetSummary = summarizeAuditText(invalidTargetText);
      if (input.audit && invalidTargetSummary) {
        this.recordAudit(input.audit, {
          event: 'mt_tag_invalid',
          job: input.audit.jobId,
          task: input.taskId,
          unit: invalidResult.unit.unitId,
          rid: invalidResult.parsedResult.responseId,
          messages: invalidResult.validationMessages,
          ...invalidTargetSummary,
        });
        this.recordAudit(input.audit, {
          event: 'mt_repair_request',
          job: input.audit.jobId,
          task: input.taskId,
          unit: invalidResult.unit.unitId,
          rid: invalidResult.parsedResult.responseId,
          reason: 'tag_invalid',
        });
      }
```

Wrap the repair call:

```ts
      try {
        const repaired = await this.repairInvalidBatchResult(
          input,
          invalidResult.unit,
          invalidResult.parsedResult,
          validationFeedback,
        );
        const repairedSummary = summarizeAuditText(
          serializeTokensToDisplayText(repaired.targetTokens),
        );
        if (input.audit && repairedSummary) {
          this.recordAudit(input.audit, {
            event: 'mt_repair_success',
            job: input.audit.jobId,
            task: input.taskId,
            unit: invalidResult.unit.unitId,
            rid: invalidResult.parsedResult.responseId,
            ...repairedSummary,
          });
        }
        repairedByResponseId.set(invalidResult.parsedResult.responseId, repaired);
      } catch (error) {
        if (input.audit) {
          this.recordAudit(input.audit, {
            event: 'mt_repair_failed',
            job: input.audit.jobId,
            task: input.taskId,
            unit: invalidResult.unit.unitId,
            rid: invalidResult.parsedResult.responseId,
            message: errorMessage(error),
          });
        }
        throw error;
      }
```

Remove the old direct `repairedByResponseId.set` call that awaited `this.repairInvalidBatchResult` inline, and replace it with the guarded `try/catch` repair block above.

- [ ] **Step 7: Run the MT audit tests**

Run:

```powershell
npx vitest run packages/localization/src/modules/MTModule.test.ts -t "repairs only the invalid Window Mode unit|rejects when single-segment repair"
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```powershell
git add packages/localization/src/modules/MTModuleTypes.ts packages/localization/src/modules/MTModule.ts packages/localization/src/modules/MTModule.test.ts
git commit -m "feat: audit mt repair flow"
```

---

### Task 4: Pass Audit From Engine And Strategies

**Files:**
- Modify: `packages/localization/src/LocalizationEngine.ts`
- Modify: `packages/localization/src/fileTranslationJobAdapter.ts`
- Modify: `packages/localization/src/projectSegmentJobAdapter.ts`
- Modify: `packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.ts`
- Modify: `packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.test.ts`
- Modify: `packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.ts`
- Modify: `packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.test.ts`
- Modify: `packages/localization/src/types.ts`
- Modify: `packages/localization/src/LocalizationEngine.test.ts`

- [ ] **Step 1: Add failing strategy tests for audit forwarding**

In both window strategy test files, update the existing `translateBatch` assertion tests to include an `auditSink` in `context`:

```ts
const auditSink = createMemoryTranslationAuditSink();
```

and context:

```ts
context: {
  job: makeJob(),
  attempt: 1,
  completedResults: new Map(),
  auditSink,
},
```

Update the existing `expect(translateBatch).toHaveBeenCalledWith` assertion in each strategy test so the expected object includes:

```ts
audit: {
  jobId: 'job-1',
  sink: auditSink,
},
```

Also assert that current units include row numbers when the job unit has `rowNumber`:

```ts
expect(translateBatch.mock.calls[0]?.[0].current[0]).toMatchObject({
  unitId: 'unit-1',
  rowNumber: 2,
});
```

- [ ] **Step 2: Run failing strategy tests**

Run:

```powershell
npx vitest run packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.test.ts packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.test.ts
```

Expected: FAIL because strategies do not pass `audit` or `rowNumber`.

- [ ] **Step 3: Add audit sink to engine options**

Modify `packages/localization/src/types.ts`:

```ts
import type { TranslationAuditSink } from './audit/TranslationAudit';
```

Add to `LocalizationEngineOptions`:

```ts
  auditSink?: TranslationAuditSink;
```

- [ ] **Step 4: Pass audit sink into file and project segment job runners**

Modify `packages/localization/src/fileTranslationJobAdapter.ts`.

Add to `TranslateSpreadsheetFileJobOptions`:

```ts
  auditSink?: TranslationJobRunnerDependencies['auditSink'];
```

Add to `runnerDependencies`:

```ts
    auditSink: options.auditSink,
```

Modify `packages/localization/src/projectSegmentJobAdapter.ts`.

Add to `TranslateProjectSegmentsJobOptions`:

```ts
  auditSink?: TranslationJobRunnerDependencies['auditSink'];
```

Add to runner dependencies:

```ts
    auditSink: options.auditSink,
```

- [ ] **Step 5: Pass audit sink from LocalizationEngine**

Modify `packages/localization/src/LocalizationEngine.ts`.

In `translateFile`, pass audit sink into `translateSpreadsheetFileJob`:

```ts
          auditSink: this.options.auditSink,
```

In `translateProjectSegments`, pass audit sink into `translateProjectSegmentsJob`:

```ts
          auditSink: this.options.auditSink,
```

In `executeTranslationTask`, pass audit into strategy calls:

```ts
      auditSink: context.auditSink,
```

- [ ] **Step 6: Pass audit and row numbers from strategies to MTModule**

In both `WindowPartialSequentialBatchStrategy.ts` and `WindowModeSequentialBatchStrategy.ts`, include `rowNumber` when building `current`:

```ts
      rowNumber: jobUnit.rowNumber,
```

Include `audit` in `translateBatch` input:

```ts
      ...(input.context.auditSink
        ? {
            audit: {
              jobId: input.context.job.id,
              sink: input.context.auditSink,
            },
          }
        : {}),
```

- [ ] **Step 7: Add an engine-level audit integration test**

In `packages/localization/src/LocalizationEngine.test.ts`, add a small test near existing `translateProjectSegments` tests. Use fake provider responses where one batch unit drops `{1}` and repair returns it.

Expected event order:

```ts
expect(auditSink.events.map((event) => event.event)).toEqual([
  'mt_batch_request',
  'mt_batch_response',
  'mt_tag_invalid',
  'mt_repair_request',
  'mt_repair_success',
  'unit_persisted',
  'runtime_tm_commit',
]);
```

Also assert the repair event proves a single segment repair:

```ts
expect(auditSink.events.find((event) => event.event === 'mt_repair_request')).toMatchObject({
  event: 'mt_repair_request',
  unit: 'row-20',
  rid: 'r1',
});
```

- [ ] **Step 8: Run engine and strategy tests**

Run:

```powershell
npx vitest run packages/localization/src/LocalizationEngine.test.ts packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.test.ts packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

Run:

```powershell
git add packages/localization/src/types.ts packages/localization/src/LocalizationEngine.ts packages/localization/src/fileTranslationJobAdapter.ts packages/localization/src/projectSegmentJobAdapter.ts packages/localization/src/LocalizationEngine.test.ts packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.ts packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.test.ts packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.ts packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.test.ts
git commit -m "feat: thread translation audit through engine"
```

---

### Task 5: Add CLI And Desktop Audit Entry Points

**Files:**
- Modify: `packages/localization/src/cli/translateFileCommand.ts`
- Modify: `apps/cli/src/commands/translateFileCommand.ts`
- Modify: `apps/cli/src/cli.test.ts`
- Create: `apps/desktop/src/main/services/modules/ai/translationAuditDebug.ts`
- Create: `apps/desktop/src/main/services/modules/ai/translationAuditDebug.test.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/main/services/ProjectService.ts`

- [ ] **Step 1: Write failing CLI argument test**

In `apps/cli/src/cli.test.ts`, extend the existing `maps translate file options to the localization command API` test command with:

```ts
'--audit',
'audit.jsonl',
```

Update the expected config:

```ts
auditPath: 'audit.jsonl',
```

- [ ] **Step 2: Add CLI config and parser support**

Modify `packages/localization/src/cli/translateFileCommand.ts`.

Add import:

```ts
import { JsonlTranslationAuditSink } from '../audit/TranslationAudit';
```

Add to `TranslateFileCommandConfig`:

```ts
  auditPath?: string;
```

In `runTranslateFileCommand`, create the sink:

```ts
  const auditSink = config.auditPath
    ? new JsonlTranslationAuditSink(config.auditPath)
    : undefined;
```

Pass it into `LocalizationEngine`:

```ts
      auditSink,
```

After `engine.translateFile(input)`, flush if present:

```ts
    const result = await engine.translateFile(input);
    await auditSink?.flush?.();
    return result;
```

In the `finally` block, keep only `db.close()`. Do not flush in `finally`; failed runs still write the queued audit lines through the same process lifetime. If implementation wants failed runs flushed too, wrap `engine.translateFile` in a `try/finally` inside the database `try` block:

```ts
    try {
      return await engine.translateFile(input);
    } finally {
      await auditSink?.flush?.();
    }
```

Use the inner `try/finally` form so failed translation attempts flush audit evidence.

Modify `apps/cli/src/commands/translateFileCommand.ts`.

Add to `TranslateFileCliConfig` through inherited config field, then in `assignOption`:

```ts
  if (name === 'audit') {
    config.auditPath = io.resolvePath(optionValue);
    return;
  }
```

Add to `isKnownOption`:

```ts
    name === 'audit' ||
```

Add to `help()`:

```text
  --audit <path>                  Optional lightweight audit JSONL path.
```

- [ ] **Step 3: Run CLI tests**

Run:

```powershell
npx vitest run apps/cli/src/cli.test.ts -t "maps translate file options"
```

Expected: PASS.

- [ ] **Step 4: Add desktop audit debug helper tests**

Create `apps/desktop/src/main/services/modules/ai/translationAuditDebug.test.ts`:

```ts
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  CAT_TRANSLATION_AUDIT_ENV,
  CAT_TRANSLATION_AUDIT_FILE_ENV,
  createTranslationAuditDebugSink,
  isTranslationAuditDebugEnabled,
} from './translationAuditDebug';

describe('translationAuditDebug', () => {
  it('detects truthy audit flags', () => {
    expect(isTranslationAuditDebugEnabled({ [CAT_TRANSLATION_AUDIT_ENV]: '1' })).toBe(true);
    expect(isTranslationAuditDebugEnabled({ [CAT_TRANSLATION_AUDIT_ENV]: 'true' })).toBe(true);
    expect(isTranslationAuditDebugEnabled({ [CAT_TRANSLATION_AUDIT_ENV]: 'off' })).toBe(false);
  });

  it('creates no sink when audit is disabled', () => {
    expect(createTranslationAuditDebugSink('D:/userData', {})).toBeUndefined();
  });

  it('creates a sink and resolves default path when audit is enabled', () => {
    const resolved = createTranslationAuditDebugSink('D:/userData', {
      [CAT_TRANSLATION_AUDIT_ENV]: '1',
    });

    expect(resolved?.filePath).toBe(join('D:/userData', 'translation_audit_debug.jsonl'));
    expect(resolved?.sink).toBeTruthy();
  });

  it('uses explicit audit file path when provided', () => {
    const resolved = createTranslationAuditDebugSink('D:/userData', {
      [CAT_TRANSLATION_AUDIT_ENV]: '1',
      [CAT_TRANSLATION_AUDIT_FILE_ENV]: 'D:/tmp/audit.jsonl',
    });

    expect(resolved?.filePath).toBe('D:/tmp/audit.jsonl');
  });
});
```

- [ ] **Step 5: Implement desktop audit debug helper**

Create `apps/desktop/src/main/services/modules/ai/translationAuditDebug.ts`:

```ts
import { join } from 'path';
import { JsonlTranslationAuditSink, type TranslationAuditSink } from '@cat/localization';

export const CAT_TRANSLATION_AUDIT_ENV = 'CAT_TRANSLATION_AUDIT';
export const CAT_TRANSLATION_AUDIT_FILE_ENV = 'CAT_TRANSLATION_AUDIT_FILE';

export interface TranslationAuditDebugSink {
  filePath: string;
  sink: TranslationAuditSink;
}

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function isTranslationAuditDebugEnabled(
  env: Pick<NodeJS.ProcessEnv, string> = process.env,
): boolean {
  return isTruthyFlag(env[CAT_TRANSLATION_AUDIT_ENV]);
}

export function createTranslationAuditDebugSink(
  userDataPath: string,
  env: Pick<NodeJS.ProcessEnv, string> = process.env,
): TranslationAuditDebugSink | undefined {
  if (!isTranslationAuditDebugEnabled(env)) {
    return undefined;
  }

  const explicitPath = env[CAT_TRANSLATION_AUDIT_FILE_ENV]?.trim();
  const filePath = explicitPath || join(userDataPath, 'translation_audit_debug.jsonl');

  return {
    filePath,
    sink: new JsonlTranslationAuditSink(filePath),
  };
}
```

- [ ] **Step 6: Pass desktop audit sink into ProjectService and LocalizationEngine**

Modify `apps/desktop/src/main/services/ProjectService.ts`.

Import type:

```ts
import type { TranslationAuditSink } from '@cat/localization';
```

Add to `ProjectServiceDependencies`:

```ts
  translationAuditSink?: TranslationAuditSink;
```

Pass into `LocalizationEngine`:

```ts
          auditSink: deps.translationAuditSink,
```

Modify `apps/desktop/src/main/index.ts`.

Import helper:

```ts
import {
  CAT_TRANSLATION_AUDIT_ENV,
  createTranslationAuditDebugSink,
} from './services/modules/ai/translationAuditDebug';
```

Before constructing `ProjectService`, add:

```ts
  const translationAudit = createTranslationAuditDebugSink(userDataPath);
  if (translationAudit) {
    console.log(`[TranslationAudit] Enabled via ${CAT_TRANSLATION_AUDIT_ENV}`);
    console.log(`[TranslationAudit] JSONL audit log: ${translationAudit.filePath}`);
  }
```

Pass to `ProjectService`:

```ts
    translationAuditSink: translationAudit?.sink,
```

- [ ] **Step 7: Run CLI and desktop helper tests**

Run:

```powershell
npx vitest run apps/cli/src/cli.test.ts apps/desktop/src/main/services/modules/ai/translationAuditDebug.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

Run:

```powershell
git add packages/localization/src/cli/translateFileCommand.ts apps/cli/src/commands/translateFileCommand.ts apps/cli/src/cli.test.ts apps/desktop/src/main/services/modules/ai/translationAuditDebug.ts apps/desktop/src/main/services/modules/ai/translationAuditDebug.test.ts apps/desktop/src/main/index.ts apps/desktop/src/main/services/ProjectService.ts
git commit -m "feat: expose translation audit for cli and desktop"
```

---

### Task 6: End-To-End Verification And Usage Notes

**Files:**
- Modify: `DOCS/superpowers/specs/2026-06-17-translation-audit-lite-design.md` only if implementation intentionally differs from the spec.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
npx vitest run packages/localization/src/audit/TranslationAudit.test.ts packages/localization/src/job/TranslationJobRunner.test.ts packages/localization/src/modules/MTModule.test.ts packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.test.ts packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.test.ts packages/localization/src/LocalizationEngine.test.ts apps/cli/src/cli.test.ts apps/desktop/src/main/services/modules/ai/translationAuditDebug.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 4: Verify CLI audit on a fake or approved real run**

Use an approved file/provider run or a fake transport harness. For the approved `test.xlsx` style command, use:

```powershell
& 'C:\Program Files\nodejs\node.exe' apps\cli\dist\index.mjs translate file --db 'C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db' --project-id 3 --input 'C:\Users\yizhi003\Desktop\test.xlsx' --output 'D:\cat\momocat\.tmp\audit-lite-output.xlsx' --request-mode window-partial --batch-size 5 --audit 'D:\cat\momocat\.tmp\audit-lite.jsonl' --progress-stdout
```

Then inspect:

```powershell
Select-String -Path 'D:\cat\momocat\.tmp\audit-lite.jsonl' -Pattern '"mt_repair_request"'
```

Expected when no tag repair happened: no matches.

Expected when a tag repair happened: at least one line containing `"event":"mt_repair_request"`.

- [ ] **Step 5: Verify desktop audit path**

Start desktop with:

```powershell
$env:CAT_TRANSLATION_AUDIT='1'
$env:CAT_TRANSLATION_AUDIT_FILE='D:\cat\momocat\.tmp\desktop-translation-audit.jsonl'
npm run dev
```

Run the desktop file translation that reproduces the suspected tag issue.

Inspect:

```powershell
Select-String -Path 'D:\cat\momocat\.tmp\desktop-translation-audit.jsonl' -Pattern '"mt_batch_request"','"mt_repair_request"','"mt_repair_success"','"unit_persisted"','"runtime_tm_commit"'
```

Interpretation:

- `mt_batch_request` exists and `mt_repair_request` does not exist: desktop sent batch requests, but no single-segment repair was triggered.
- `mt_repair_request` exists and `mt_repair_success` exists: desktop sent single-segment repair and repair succeeded.
- `mt_repair_request` exists and `unit_persisted` for the same unit does not exist: repair path happened, but result persistence did not complete.
- `unit_persisted` exists and `runtime_tm_commit` exists afterward: the repaired or translated result made it through persistence and runtime TM commit.

- [ ] **Step 6: Commit verification adjustments if any**

If no implementation adjustments were needed, skip this step. If a small correction was made during verification, stage only the file or files changed by that correction and commit with:

```powershell
git commit -m "test: verify translation audit lite"
```

---

## Final Success Criteria

- CLI supports `--audit <path>`.
- Desktop supports `CAT_TRANSLATION_AUDIT=1` and `CAT_TRANSLATION_AUDIT_FILE=<path>`.
- Audit JSONL records are small and contain no full prompt, provider response, source text, or target text.
- Disabled audit is a no-op path.
- A desktop file translation run can prove whether single-segment repair was sent by checking for `mt_repair_request`.
- A successful repaired unit can be followed through `mt_repair_success`, `unit_persisted`, and `runtime_tm_commit`.
- Focused tests, typecheck, and build pass.
