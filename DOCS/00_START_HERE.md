# 00_START_HERE

## Purpose

Provide a deterministic onboarding entrypoint for humans and AI agents to start work in under 10 minutes.

## Branch Design Core

This branch, `agent-first-batch-ai-mvp`, is designed around agents as the primary operators. It is moving the project toward a CLI-first, agent-first batch localization workstation where humans and agents can inspect, run, resume, and automate localization work without depending on the legacy desktop editor.

Core direction:

- Design for agent-first workflows first: deterministic CLI commands, inspectable artifacts, resumable jobs, and clean headless orchestration.
- Keep the legacy desktop CAT UI available, but do not make it the center of new feature work on this branch.
- Put reusable public localization capability in the shared packages: TM, TB, MT, tag/protected-marker handling, prompt builders, response parsers, validation, and persistence boundaries.
- Treat `LocalizationEngine` as the headless TM + TB + MT engine boundary.
- Keep core localization/domain capability in `packages/core` and existing core services. The headless CLI layer is an orchestrator, assembler, and consumer of those capabilities, not the place to bury domain logic.
- Prefer CLI and future API workflows over CAT editor UI changes.
- Keep external files outside project `files` and `segments` during headless translation.
- Keep the design modular: File layer, JobRunner, LocalizationEngine, TMModule, TBModule, and MTModule should stay separately understandable and replaceable.
- Keep normal runs lightweight and clean: output, checkpoint, events, and throttled snapshot by default; full prompt/TM/TB artifacts only for inspect or explicit diagnostic runs.
- Keep implementation simple and elegant. Avoid piling rules into one place when a small typed boundary or module contract can carry the design.

The two priority areas are core shared localization capability and agent-first CLI/headless operation. The existing CAT UI is still present, but it is not the center of this branch's architecture work.

## When to Read

Read first for every new task, new session, or handoff.

## Source of Truth

- Runtime behavior: code + tests
- Process and guardrails: `DOCS/20_ENGINEERING_RUNBOOK.md`
- Current project status and priorities: `DOCS/40_STATUS_AND_ROADMAP.md`
- System boundaries: `DOCS/10_ARCHITECTURE.md`
- Agent-first engine: `DOCS/agent-first/ARCHITECTURE.md`
- Agent-first CLI commands: `DOCS/agent-first/CLI.md`
- MT prompt and request scheduling: `DOCS/agent-first/MT_MODULE.md`
- MT Window Mode design: `DOCS/superpowers/specs/2026-05-20-mt-window-mode-design.md`
- Next MT direction decision: `DOCS/superpowers/specs/2026-05-20-agent-first-cli-mt-next-direction-design.md`
- Completed localization package migration record: `DOCS/superpowers/specs/2026-05-20-localization-package-boundary-design.md`

## Last Updated

2026-05-20

## Owner

Core maintainers of `simple-cat-tool`

## 10-Minute Boot Path

1. Read `DOCS/40_STATUS_AND_ROADMAP.md` (current status, current risks, now/next/later).
2. Read `DOCS/20_ENGINEERING_RUNBOOK.md` (workflow rules, gates, PR checklist).
3. Read `DOCS/10_ARCHITECTURE.md` for boundaries and entrypoints.
4. For agent-first CLI, file translation, inspect, or MT module work, read `DOCS/agent-first/ARCHITECTURE.md`, `DOCS/agent-first/CLI.md`, and `DOCS/agent-first/MT_MODULE.md`.
5. If data-layer changes are involved, read `DOCS/30_DATA_MODEL.md`.
6. Implement and validate with the smallest command set that proves the touched boundary.

## Essential Commands

Run from repo root:

```bash
npm ci
npm run rebuild:electron
npm run dev
npm run gate:check
```

Agent-first CLI:

- Project check: `npm run inspect:projects -- --db <path> --project-id <id>`
- No-request prompt inspection: `npm run inspect:localization -- --db <path> --project-id <id> --input <path> --output <inspect.xlsx>`
- Resumable file translation: `npm run translate:file -- --db <path> --project-id <id> --input <path> --output <translated.xlsx>`
- Real translation artifacts are opt-in with `--artifacts <path>`; inspect is the preferred prompt-debug path.

## If Task Is X, Open Y

| Task type                            | Open first                                                     |
| ------------------------------------ | -------------------------------------------------------------- |
| New feature touching renderer flow   | `DOCS/10_ARCHITECTURE.md`                                      |
| Main process service/module changes  | `DOCS/10_ARCHITECTURE.md`                                      |
| Agent-first CLI or LocalizationEngine | `DOCS/agent-first/ARCHITECTURE.md` and `DOCS/agent-first/CLI.md` |
| MT prompt or request scheduling      | `DOCS/agent-first/MT_MODULE.md`                                |
| IPC contract changes                 | `DOCS/10_ARCHITECTURE.md` and `DOCS/20_ENGINEERING_RUNBOOK.md` |
| Schema/repo SQL work                 | `DOCS/30_DATA_MODEL.md`                                        |
| Build/test/gate failures             | `DOCS/20_ENGINEERING_RUNBOOK.md`                               |
| Priorities and risk decisions        | `DOCS/40_STATUS_AND_ROADMAP.md`                                |
| Historical context for old decisions | `DOCS/90_HISTORY_CONSOLIDATED.md`                              |

## Targeted Validation

Use `npm run gate:check` as the broad repo gate. For focused validation, use the touched document or module's linked runbook; do not copy long test matrices into this entrypoint.

## Test Layout

1. Default to colocated tests: keep unit, behavior, and integration tests next to the code they exercise.
2. Use `*.test.ts` or `*.test.tsx` so targeted `vitest run <path>` stays predictable during refactors.
3. Keep end-to-end coverage centralized under `apps/desktop/e2e`.
4. Extract shared fixtures/helpers only when reused across multiple nearby tests; do not move entire suites into a repo-level `tests/` folder by default.

## Fast Code Entry Index

- Renderer root: `apps/desktop/src/renderer/src`
- Main process root: `apps/desktop/src/main`
- Agent-first localization: `packages/localization/src`
- Shared IPC contract: `apps/desktop/src/shared/ipc.ts`
- Core package: `packages/core/src`
- AI prompt templates and future pure MT builders: `packages/core/src/project`
- DB package: `packages/db/src`

## Documentation Rules

1. Keep this file short and deterministic.
2. Do not duplicate architecture or schema details here.
3. Add links, not long narrative, when adding new subsystems.
