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

2026-03-29

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

Windows note:

- Packaging and Electron rebuild scripts invoke `npm`/`npx` through the Windows shell to avoid `.cmd` spawn failures such as `spawnSync npm.cmd EINVAL` in some PowerShell/Volta setups.

## Platform Command Matrix

Run from repo root `simple-cat-tool`.

| Task | When to use | Command | Platform | Expected result |
| --- | --- | --- | --- | --- |
| Start local development | First boot or manual app verification | `npm ci` -> `npm run rebuild:electron` -> `npm run dev` | Windows + macOS | Electron app starts with native module rebuilt for current host |
| Run unit/integration baseline | Any code change before deeper validation | `npm test` | Windows + macOS | Vitest suites pass |
| Run repo quality gate | Default cross-platform baseline before pack guesses | `npm run gate:check` | Windows + macOS | Typecheck + guardrails + lint + smoke gate pass |
| Run desktop smoke e2e | UI/editor behavior changed, need fastest desktop confidence | `npm run test:e2e:smoke --workspace=apps/desktop` | Windows + macOS | Smoke Playwright suite passes against built desktop app |
| Run full desktop e2e | Smoke is not enough or broader desktop regression coverage is needed | `npm run test:e2e --workspace=apps/desktop` | Windows + macOS | Full Playwright suite passes |
| Validate Windows packaging | Need native Windows installer artifact validation | `npm run pack:win` | Windows only | `.exe` packaging flow completes on Windows host |
| Validate macOS packaging | Need native macOS installer artifact validation | `npm run pack:mac` | macOS only | `.dmg` packaging flow completes on macOS host |

Notes:

- `npm run pack` only packages for the current host platform; do not treat it as Win/mac release signoff.
- CI covers `npm ci` -> `npm run rebuild:electron` -> `npm run gate:check` on both Windows and macOS, but platform packaging still requires native hosts.

## Agent Guardrails

1. Start with `npm run gate:check` for cross-platform baseline validation; do not guess packaging commands first.
2. Use `npm run test:e2e:smoke --workspace=apps/desktop` before full e2e when you need desktop behavior confidence quickly.
3. Never mix `pack:win` and `pack:mac` across hosts; packaging validation is platform-native only.
4. If Windows/macOS commands behave differently, run `npm run rebuild:electron` before deeper debugging.

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
npm run test:e2e:smoke --workspace=apps/desktop
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

## Test Layout

1. Default to colocated tests: keep unit, behavior, and integration tests next to the code they exercise.
2. Use `*.test.ts` or `*.test.tsx` so targeted `vitest run <path>` stays predictable during refactors.
3. Keep end-to-end coverage centralized under `apps/desktop/e2e`.
4. Extract shared fixtures/helpers only when reused across multiple nearby tests; do not move entire suites into a repo-level `tests/` folder by default.

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
