import type { ProxySettingsController } from './useProxySettingsController';

interface ProxySettingsTabProps {
  controller: ProxySettingsController;
}

export function ProxySettingsTab({ controller }: ProxySettingsTabProps) {
  return (
    <section className="surface-card p-4 space-y-3">
      <h3 className="text-sm font-bold text-text">Proxy Settings</h3>
      <div className="space-y-2 text-sm text-text-muted">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="proxy-mode"
            checked={controller.mode === 'off'}
            onChange={() => controller.setMode('off')}
            className="accent-brand"
          />
          <span>No Proxy (Direct)</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="proxy-mode"
            checked={controller.mode === 'system'}
            onChange={() => controller.setMode('system')}
            className="accent-brand"
          />
          <span>Use System/Environment Proxy</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="proxy-mode"
            checked={controller.mode === 'custom'}
            onChange={() => controller.setMode('custom')}
            className="accent-brand"
          />
          <span>Use Custom Proxy URL</span>
        </label>
      </div>

      {controller.mode === 'custom' && (
        <input
          aria-label="Custom Proxy URL"
          type="text"
          value={controller.customProxyUrl}
          onChange={(event) => controller.setCustomProxyUrl(event.target.value)}
          placeholder="http://127.0.0.1:7890"
          className="field-input"
        />
      )}

      <p className="text-[11px] text-text-muted">
        Active proxy: {controller.effectiveProxyUrl || 'None (direct)'}
      </p>

      <button
        onClick={() => void controller.saveProxySettings()}
        disabled={controller.loading || controller.saving}
        className="btn-secondary w-full"
      >
        {controller.saving ? 'Saving Proxy...' : 'Save Proxy Settings'}
      </button>
      {controller.status && <div className="status-note">{controller.status}</div>}
    </section>
  );
}
