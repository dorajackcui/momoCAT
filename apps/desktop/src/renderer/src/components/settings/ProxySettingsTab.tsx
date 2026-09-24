import { Radio, Input, Button } from '../ui';
import type { ProxySettingsController } from './useProxySettingsController';

interface ProxySettingsTabProps {
  controller: ProxySettingsController;
  busy: boolean;
}

export function ProxySettingsTab({ controller, busy }: ProxySettingsTabProps) {
  return (
    <section className="workspace-settings-section">
      <h3 className="workspace-settings-heading">Connection mode</h3>
      <div className="space-y-3 text-sm text-text">
        <label className="flex items-center gap-2">
          <Radio
            name="proxy-mode"
            checked={controller.mode === 'off'}
            onChange={() => controller.setMode('off')}
          />
          <span>No proxy (direct)</span>
        </label>
        <label className="flex items-center gap-2">
          <Radio
            name="proxy-mode"
            checked={controller.mode === 'system'}
            onChange={() => controller.setMode('system')}
          />
          <span>Use system/environment proxy</span>
        </label>
        <label className="flex items-center gap-2">
          <Radio
            name="proxy-mode"
            checked={controller.mode === 'custom'}
            onChange={() => controller.setMode('custom')}
          />
          <span>Use custom proxy URL</span>
        </label>
      </div>

      {controller.mode === 'custom' && (
        <Input
          aria-label="Custom proxy URL"
          type="text"
          value={controller.customProxyUrl}
          onChange={(event) => controller.setCustomProxyUrl(event.target.value)}
          placeholder="http://127.0.0.1:7890"
        />
      )}

      <p className="text-xs text-text-muted">
        Active proxy: {controller.effectiveProxyUrl || 'None (direct)'}
      </p>

      {controller.status && <div className="status-note">{controller.status}</div>}
      <div className="workspace-settings-actions">
        <Button
          variant="primary"
          onClick={() => void controller.saveProxySettings()}
          disabled={busy}
        >
          {controller.saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </section>
  );
}
