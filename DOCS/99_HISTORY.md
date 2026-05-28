# 99_HISTORY

## Purpose

Sanitized index of retired decisions, old design records, and historical
incidents. This file is not active policy.

## Active Policy Lives Elsewhere

- Architecture: `10_ARCHITECTURE.md`
- Engineering workflow: `20_ENGINEERING_RUNBOOK.md`
- CLI operation: `40_CLI_OPERATION.md`
- MT request model: `50_MT_REQUEST_MODEL.md`
- TM/TB reference: `60_TM_TB_REFERENCE.md`
- Live status: `90_STATUS_AND_ROADMAP.md`

## Retired Documentation Sets

- Earlier agent-first architecture, CLI, and MT notes were consolidated into
  the active outer numbered docs.
- Earlier TM/TB recall and concordance notes were consolidated into
  `60_TM_TB_REFERENCE.md`.
- Earlier implementation specs and plans in the retired specs/plans directory
  were retired as active policy.
- Runtime TM development spec and implementation plan were retired from active
  docs after implementation. Durable behavior now lives in
  `50_MT_REQUEST_MODEL.md`, `60_TM_TB_REFERENCE.md`, and
  `90_STATUS_AND_ROADMAP.md`; archived records are under
  `DOCS/archive/runtime-tm/`.

## Retired Superpowers Specs And Plans

Historical specs and implementation plans were consolidated during the docs
system cleanup. Active guidance is now in the outer numbered docs. Archived
records, when retained, are sanitized and non-active.

## Durable Historical Lessons

- Split large modules behind compatibility facades before deepening internal
  changes.
- Contract-first boundaries reduce cross-layer drift and runtime surprises.
- Long-running workflows need unified progress and failure semantics.
- Gate automation should encode architecture and process decisions, not only
  style rules.
- UI editing flows need explicit state and DOM synchronization safeguards.

## Sanitization Policy

History entries must not include real project names, character names, provider
endpoints, model names from private provider configuration, local paths, API
keys, or private source/target text.
