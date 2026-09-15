import { useState } from 'react';
import type { AppUpdatesController } from '../hooks/useAppUpdates';
import { AIConnectionsTab } from './settings/AIConnectionsTab';
import { ProxySettingsTab } from './settings/ProxySettingsTab';
import { TermExtractionPromptTab } from './settings/TermExtractionPromptTab';
import { UpdatesTab } from './settings/UpdatesTab';
import { useAIConnectionsController } from './settings/useAIConnectionsController';
import { useProxySettingsController } from './settings/useProxySettingsController';

type SettingsTabId = 'connections' | 'term-extraction' | 'proxy' | 'updates';

const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string }> = [
  { id: 'connections', label: 'AI Connections' },
  { id: 'term-extraction', label: 'Term Extraction' },
  { id: 'proxy', label: 'Proxy' },
  { id: 'updates', label: 'Updates' },
];

export function SettingsPage({ updates }: { updates: AppUpdatesController }) {
  const proxySettings = useProxySettingsController(true);
  const aiConnections = useAIConnectionsController(true, proxySettings.applyProxySettings);
  const [activeTab, setActiveTab] = useState<SettingsTabId>('connections');

  const busy = aiConnections.busy || proxySettings.loading || proxySettings.saving;

  return (
    <div className="workspace-settings-page">
      <div className="workspace-page-header">
        <h2 className="text-xl font-bold text-text">Settings</h2>
      </div>

      <div
        role="tablist"
        aria-label="Settings sections"
        className="px-6 py-3 border-b border-border flex items-center gap-2 overflow-x-auto"
      >
        {SETTINGS_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={
                isActive
                  ? 'inline-flex h-9 shrink-0 items-center justify-center rounded-control px-4 text-sm font-semibold leading-5 bg-brand text-white whitespace-nowrap'
                  : 'inline-flex h-9 shrink-0 items-center justify-center rounded-control px-4 text-sm font-medium leading-5 text-text-muted hover:text-text hover:bg-muted transition-colors whitespace-nowrap'
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="workspace-settings-content" style={{ scrollbarGutter: 'stable' }}>
        {activeTab === 'connections' && <AIConnectionsTab controller={aiConnections} busy={busy} />}
        {activeTab === 'term-extraction' && <TermExtractionPromptTab />}
        {activeTab === 'proxy' && <ProxySettingsTab controller={proxySettings} busy={busy} />}
        {activeTab === 'connections' && aiConnections.status && (
          <div className="status-note">{aiConnections.status}</div>
        )}
        {activeTab === 'updates' && <UpdatesTab controller={updates} />}
      </div>
    </div>
  );
}
