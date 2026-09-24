import { Button } from '../ui';
import { version } from '../../../../../package.json';
import type { AppUpdatesController } from '../../hooks/useAppUpdates';

export function UpdatesTab({ controller }: { controller: AppUpdatesController }) {
  return (
    <section className="workspace-settings-section" aria-label="Software updates">
      <h3 className="workspace-settings-heading">momoCAT</h3>
      <p className="text-xs text-text-muted">Current version: v{version}</p>
      {controller.statusMessage && (
        <p role="status" className="text-xs text-text-muted">
          {controller.statusMessage}
        </p>
      )}
      <div className="workspace-settings-actions">
        <Button
          variant="primary"
          type="button"
          onClick={controller.checkForUpdates}
          disabled={controller.isBusy}
          title="Check for momoCAT updates"
        >
          {controller.isBusy ? 'Updating…' : 'Check for updates'}
        </Button>
      </div>
    </section>
  );
}
