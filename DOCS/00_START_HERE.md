# 00_START_HERE

## Purpose

Provide a deterministic onboarding entrypoint for humans and AI agents to start work in under 10 minutes.

## When to Read

Read first for every new task, new session, or handoff.

## Source of Truth

- Runtime behavior: code + tests
- Process and guardrails: `DOCS/20_ENGINEERING_RUNBOOK.md`
- Current project status and priorities: `DOCS/40_STATUS_AND_ROADMAP.md`

## Last Updated

2026-03-24

## Owner

Core maintainers of `simple-cat-tool`

## 10-Minute Boot Path

1. Read `DOCS/40_STATUS_AND_ROADMAP.md` (current status, current risks, now/next/later).
2. Read `DOCS/20_ENGINEERING_RUNBOOK.md` (workflow rules, gates, PR checklist).
3. Read `DOCS/10_ARCHITECTURE.md` for boundaries and entrypoints.
4. If data-layer changes are involved, read `DOCS/30_DATA_MODEL.md`.
5. Implement and validate with the canonical command checklist below.

## Dual-Platform Quick Boot (Windows + macOS)

Run from repo root:

```bash
npm ci
npm run rebuild:electron
npm run dev
```

Package validation by target OS:

1. Windows: `npm run pack:win`
2. macOS: `npm run pack:mac`

## If Task Is X, Open Y

| Task type                            | Open first                                                     |
| ------------------------------------ | -------------------------------------------------------------- |
| New feature touching renderer flow   | `DOCS/10_ARCHITECTURE.md`                                      |
| Main process service/module changes  | `DOCS/10_ARCHITECTURE.md`                                      |
| IPC contract changes                 | `DOCS/10_ARCHITECTURE.md` and `DOCS/20_ENGINEERING_RUNBOOK.md` |
| Schema/repo SQL work                 | `DOCS/30_DATA_MODEL.md`                                        |
| Build/test/gate failures             | `DOCS/20_ENGINEERING_RUNBOOK.md`                               |
| Priorities and risk decisions        | `DOCS/40_STATUS_AND_ROADMAP.md`                                |
| Historical context for old decisions | `DOCS/90_HISTORY_CONSOLIDATED.md`                              |

## Canonical Command Checklist

Run from repo root `simple-cat-tool`.

```bash
npm run gate:check
```

Targeted tests (run when touching corresponding areas):

```bash
npx vitest run apps/desktop/src/main/services/modules/AIModule.test.ts
npx vitest run apps/desktop/src/main/services/modules/ai/AITranslationWorkflows.test.ts
npx vitest run apps/desktop/src/main/services/modules/TMModule.test.ts
npx vitest run apps/desktop/src/renderer/src/hooks/useEditor.test.ts
npx vitest run apps/desktop/src/renderer/src/hooks/projectDetail/useProjectAI.test.ts
npx vitest run apps/desktop/src/renderer/src/hooks/projectDetail/useProjectAI.behavior.test.ts
npx vitest run apps/desktop/src/renderer/src/hooks/useEditorFilters.test.ts
npx vitest run apps/desktop/src/renderer/src/hooks/useEditorFilters.behavior.test.ts
npx vitest run apps/desktop/src/renderer/src/components/EditorRow.integration.test.ts
npx vitest run apps/desktop/src/renderer/src/components/editor-row/useEditorRowDisplayModel.test.ts
npx vitest run apps/desktop/src/renderer/src/components/editor-row/useEditorRowCommandHandlers.test.ts
npx vitest run packages/db/src/currentSchema.test.ts
npx vitest run packages/core/src/TagManager.test.ts
```

## Fast Code Entry Index

- Renderer root: `apps/desktop/src/renderer/src`
- Main process root: `apps/desktop/src/main`
- Shared IPC contract: `apps/desktop/src/shared/ipc.ts`
- Core package: `packages/core/src`
- DB package: `packages/db/src`

## Documentation Rules

1. Keep this file short and deterministic.
2. Do not duplicate architecture or schema details here.
3. Add links, not long narrative, when adding new subsystems.
