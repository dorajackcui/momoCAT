# 90_STATUS_AND_ROADMAP

## Purpose

Single live source for current phase, risk posture, and roadmap.

## Current Phase

Agent-first CLI/headless localization. Shared capability lives behind
`@cat/localization`; `momocat` is the CLI app surface.

## Current Top Risks

1. CLI must remain thin over `@cat/localization`.
2. Prompt/request-mode contracts must stay centralized in `50_MT_REQUEST_MODEL.md`.
3. Real smoke artifacts may contain private source text and provider metadata;
   keep them out of active docs and source files.

## Latest Focused Verification

Verification date: 2026-05-25

- Top-level active docs listing matched the consolidated numbered docs set.
- Old active doc path scan across active docs returned no matches.
- Sensitive/local/private value scan across active docs returned only generic
  policy references.
- Markdown whitespace validation completed with no issues.

## Roadmap

### Now

- Keep active docs consolidated in outer numbered files.
- Keep CLI/headless behavior documented for work agents.
- Keep architecture and request contracts documented for coding agents.
- Prepare Runtime TM implementation from `70_RUNTIME_TM_SPEC.md`.

### Next

- Continue hardening CLI command grammar and inspect artifacts.
- Continue strengthening `@cat/localization` Runtime TM, request-mode, and pure
  `@cat/core` MT helpers.

### Later

- Add service/API surfaces above the same headless localization boundary when
  needed.
