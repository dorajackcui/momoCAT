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

Verification date: 2026-05-27

- Runtime TM focused tests passed for runtime TM modules, job hooks, and
  headless file translation coverage using mocked/local transports.
- Window and Window Partial request-mode strategy tests passed.
- `@cat/localization` typecheck and build passed, and the CLI build passed.
- Sensitive/path scan across docs plus Runtime TM source and tests returned
  only generic docs/test fixture references. No real provider config, base
  URLs, API keys, local paths, or private prompt/artifact data were added.
- No real provider smoke tests were run.

## Roadmap

### Now

- Keep active docs consolidated in outer numbered files.
- Keep CLI/headless behavior documented for work agents.
- Keep architecture and request contracts documented for coding agents.
- Runtime TM is implemented for headless file translate jobs using
  `requestMode=window` and `requestMode=window-partial`. It is job-local,
  keeps independent caps of 3 TM and 3 concordance references, and does not
  pollute persistent TM data.

### Next

- Continue hardening CLI command grammar and inspect artifacts.
- Continue strengthening `@cat/localization` request-mode behavior and pure
  `@cat/core` MT helpers.

### Later

- Add service/API surfaces above the same headless localization boundary when
  needed.
