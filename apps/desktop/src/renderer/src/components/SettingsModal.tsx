import { useState } from 'react';
import { AIConnectionsTab } from './settings/AIConnectionsTab';
import { ProxySettingsTab } from './settings/ProxySettingsTab';
import { TermExtractionPromptTab } from './settings/TermExtractionPromptTab';
import { useAIConnectionsController } from './settings/useAIConnectionsController';
import { useProxySettingsController } from './settings/useProxySettingsController';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTabId = 'connections' | 'term-extraction' | 'proxy';

const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string }> = [
  { id: 'connections', label: 'AI Connections' },
  { id: 'term-extraction', label: 'Term Extraction' },
  { id: 'proxy', label: 'Proxy' },
];

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  if (!isOpen) return null;

  return <OpenSettingsModal onClose={onClose} />;
}

function OpenSettingsModal({ onClose }: Pick<SettingsModalProps, 'onClose'>) {
  const proxySettings = useProxySettingsController(true);
  const aiConnections = useAIConnectionsController(true, proxySettings.applyProxySettings);
  const [activeTab, setActiveTab] = useState<SettingsTabId>('connections');

  const busy = aiConnections.busy || proxySettings.loading || proxySettings.saving;

  return (
    <div className="settings-modal-backdrop">
      <div className="modal-card max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="modal-header">
          <h2 className="text-xl font-bold text-text">Settings</h2>
          <button
            onClick={onClose}
            className="text-text-faint hover:text-text-muted transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
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

        <div
          className="modal-body flex-1 overflow-y-auto space-y-4"
          style={{ scrollbarGutter: 'stable' }}
        >
          {activeTab === 'connections' && (
            <AIConnectionsTab controller={aiConnections} busy={busy} />
          )}
          {activeTab === 'term-extraction' && <TermExtractionPromptTab />}
          {activeTab === 'proxy' && <ProxySettingsTab controller={proxySettings} busy={busy} />}
          {activeTab === 'connections' && aiConnections.status && (
            <div className="status-note">{aiConnections.status}</div>
          )}
        </div>
      </div>
    </div>
  );
}
