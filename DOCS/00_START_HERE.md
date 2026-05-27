# 00_START_HERE

## Purpose

Provide the single entrypoint for coding agents and work agents.

## Project Direction

This branch is agent-first and CLI-first. New localization capability should
land in shared packages and headless workflows before legacy desktop UI
integration. The desktop app remains a peer consumer of shared localization
capability.

## Choose Your Path

| Agent mode | Read first | Goal |
| --- | --- | --- |
| Coding agent | `10_ARCHITECTURE.md`, then `20_ENGINEERING_RUNBOOK.md` | Understand boundaries and validation before editing. |
| Work agent | `40_CLI_OPERATION.md` | Inspect projects, run translation, resume jobs, and read outputs. |
| MT/request-model work | `50_MT_REQUEST_MODEL.md` | Understand Window Mode and Partial Window Mode contracts. |
| TM/TB behavior work | `60_TM_TB_REFERENCE.md` | Understand current reference matching and prompt inputs. |
| Runtime TM work | `70_RUNTIME_TM_SPEC.md` | Understand job-local Runtime TM design. |
| Runtime TM implementation | `71_RUNTIME_TM_IMPLEMENTATION_PLAN.md` | Execute the Runtime TM plan task-by-task. |
| DB/schema work | `30_DATA_MODEL.md` | Understand persistence contracts. |
| Planning or risk review | `90_STATUS_AND_ROADMAP.md` | Understand current phase and active risks. |

## Active Docs

- `10_ARCHITECTURE.md`: development boundaries and dependency direction.
- `20_ENGINEERING_RUNBOOK.md`: coding workflow and verification.
- `30_DATA_MODEL.md`: database and persistence reference.
- `40_CLI_OPERATION.md`: CLI/headless operating manual.
- `50_MT_REQUEST_MODEL.md`: MT request and prompt contracts.
- `60_TM_TB_REFERENCE.md`: TM/TB reference behavior.
- `70_RUNTIME_TM_SPEC.md`: job-local Runtime TM design.
- `71_RUNTIME_TM_IMPLEMENTATION_PLAN.md`: Runtime TM implementation plan.
- `90_STATUS_AND_ROADMAP.md`: live status and roadmap.
- `99_HISTORY.md`: sanitized historical index.

## Documentation Rules

- Active facts have one owner document.
- Link to the owner instead of repeating details.
- Do not put real local paths, provider details, project names, or private text
  in active docs.
- Archive material is not active policy.
