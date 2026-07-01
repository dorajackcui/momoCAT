# AI Translate Soft Cancel Design

## Goal

Desktop AI file translation can be stopped while it is running. Already written segment results are kept, and cancellation prevents later results from being applied.

## Scope

- Add a cancel IPC path for AI file jobs.
- Add a runtime cancellation token owned by `JobManager`.
- Thread the token through desktop AI file translation into the localization job runner.
- Add Stop UI in the project file card and editor batch action bar.
- Keep transport-level request abort out of scope. The first version stops at task/result boundaries.

## Behavior

- Starting a file translation creates a running job and a cancellation token.
- Clicking `Stop` requests cancellation for that job and changes the running job message to `Stopping...`.
- The localization runner checks the token before starting a task and before applying each returned result.
- A result that already started applying may finish. No later result starts applying after cancellation is observed.
- When the background translation resolves after a cancellation request, the desktop job becomes `cancelled`.
- Cancelled jobs reload editor/project data so partial results are visible.

## UI

- Project file card:
  - Idle: `AI Translate`, `AI Review`, or `AI Process`.
  - Running: the same button position becomes `Stop`.
  - Stop requested: `Stopping...`, disabled.
- Editor batch action bar:
  - Idle: AI batch translate icon opens the modal.
  - Running: the same icon position becomes a Stop control with title `Stop AI translation`.
  - Stop requested: disabled with title `Stopping AI translation...`.
- Cancelled progress uses warning color and message `Cancelled. Partial results kept.` when no better message is provided.

## Tests

- `TranslationJobRunner` stops launching later tasks after token cancellation and does not persist their results.
- AI IPC exposes a cancel handler and marks a requested job as cancelled when the translation call settles.
- Preload maps the cancel API to the expected IPC channel.
- Project file card renders `Stop` for running AI jobs and invokes the controller cancel method.
- Editor batch action bar invokes the cancel callback while AI batch translation is running.
