import { Radio, Input, Button } from '../ui';
import type { ProxySettingsController } from './useProxySettingsController';

interface ProxySettingsTabProps {
  controller: ProxySettingsController;
  busy: boolean;
}

export function ProxySettingsTab({ controller, busy }: ProxySettingsTabProps) {
  return (
    <section className="surface-card p-4 space-y-3">
      <h3 className="text-sm font-bold text-text">Proxy Settings</h3>
      <div className="space-y-2 text-sm text-text-muted">
        <label className="flex items-center gap-2">
          <Radio
            name="proxy-mode"
            checked={controller.mode === 'off'}
            onChange={() => controller.setMode('off')}
            className="accent-brand"
          />
          <span>No Proxy (Direct)</span>
        </label>
        <label className="flex items-center gap-2">
          <Radio
            name="proxy-mode"
            checked={controller.mode === 'system'}
            onChange={() => controller.setMode('system')}
            className="accent-brand"
          />
          <span>Use System/Environment Proxy</span>
        </label>
        <label className="flex items-center gap-2">
          <Radio
            name="proxy-mode"
            checked={controller.mode === 'custom'}
            onChange={() => controller.setMode('custom')}
            className="accent-brand"
          />
          <span>Use Custom Proxy URL</span>
        </label>
      </div>

      {controller.mode === 'custom' && (
        <Input
          aria-label="Custom Proxy URL"
          type="text"
          value={controller.customProxyUrl}
          onChange={(event) => controller.setCustomProxyUrl(event.target.value)}
          placeholder="http://127.0.0.1:7890"
        />
      )}

      <p className="text-[11px] text-text-muted">
        Active proxy: {controller.effectiveProxyUrl || 'None (direct)'}
      </p>

      <Button
        variant="secondary"
        onClick={() => void controller.saveProxySettings()}
        disabled={busy}
        className="w-full"
      >
        {controller.saving ? 'Saving Proxy...' : 'Save Proxy Settings'}
      </Button>
      {controller.status && <div className="status-note">{controller.status}</div>}
    </section>
  );
}
