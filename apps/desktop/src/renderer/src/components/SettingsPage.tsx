import { AppearanceControls, Tabs, TabsList, TabsPanel } from './ui';
import { useState } from 'react';
import type { AppUpdatesController } from '../hooks/useAppUpdates';
import { AIConnectionsTab } from './settings/AIConnectionsTab';
import { ProxySettingsTab } from './settings/ProxySettingsTab';
import { TermExtractionPromptTab } from './settings/TermExtractionPromptTab';
import { UpdatesTab } from './settings/UpdatesTab';
import { useAIConnectionsController } from './settings/useAIConnectionsController';
import { useProxySettingsController } from './settings/useProxySettingsController';

type SettingsTabId = 'connections' | 'term-extraction' | 'proxy' | 'updates' | 'appearance';

const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string }> = [
  { id: 'connections', label: 'AI Connections' },
  { id: 'proxy', label: 'Proxy' },
  { id: 'term-extraction', label: 'Term Extraction' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'updates', label: 'Updates' },
];

export function SettingsPage({ updates }: { updates: AppUpdatesController }) {
  const proxySettings = useProxySettingsController(true);
  const aiConnections = useAIConnectionsController(true, proxySettings.applyProxySettings);
  const [activeTab, setActiveTab] = useState<SettingsTabId>('connections');

  const busy = aiConnections.busy || proxySettings.loading || proxySettings.saving;

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as SettingsTabId)}
      className="workspace-settings-page"
    >
      <div className="workspace-page-header">
        <h2 className="text-xl font-semibold text-text">Settings</h2>
      </div>

      <div className="px-6 py-3 border-b border-border-subtle">
        <TabsList
          label="Settings sections"
          items={SETTINGS_TABS.map((tab) => ({ value: tab.id, label: tab.label }))}
        />
      </div>

      <TabsPanel
        value={activeTab}
        className="workspace-settings-content"
        style={{ scrollbarGutter: 'stable' }}
      >
        <div className="w-full max-w-3xl space-y-6">
          {activeTab === 'connections' && (
            <AIConnectionsTab controller={aiConnections} busy={busy} />
          )}
          {activeTab === 'term-extraction' && <TermExtractionPromptTab />}
          {activeTab === 'proxy' && <ProxySettingsTab controller={proxySettings} busy={busy} />}
          {activeTab === 'appearance' && <AppearanceControls layout="settings" />}
          {activeTab === 'connections' && aiConnections.status && (
            <div className="status-note">{aiConnections.status}</div>
          )}
          {activeTab === 'updates' && <UpdatesTab controller={updates} />}
        </div>
      </TabsPanel>
    </Tabs>
  );
}
