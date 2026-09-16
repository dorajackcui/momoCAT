import { Button } from '../ui';
import { version } from '../../../../../package.json';
import type { AppUpdatesController } from '../../hooks/useAppUpdates';

export function UpdatesTab({ controller }: { controller: AppUpdatesController }) {
  return (
    <section className="surface-card p-5 space-y-4" aria-label="Software updates">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">MomoCAT</h3>
          <p className="text-sm text-text-muted mt-1">Current version: v{version}</p>
        </div>
        <Button
          variant="secondary"
          type="button"
          onClick={controller.checkForUpdates}
          disabled={controller.isBusy}
          title="Check for momoCAT updates"
        >
          {controller.isBusy ? 'Updating…' : 'Check for updates'}
        </Button>
      </div>
      {controller.statusMessage && (
        <p role="status" className="text-sm text-text-muted">
          {controller.statusMessage}
        </p>
      )}
    </section>
  );
}
