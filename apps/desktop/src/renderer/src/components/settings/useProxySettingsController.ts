import { useCallback, useEffect, useState } from 'react';
import type { ProxyMode, ProxySettings } from '../../../../shared/ipc';
import { apiClient } from '../../services/apiClient';

export interface ProxySettingsController {
  mode: ProxyMode;
  setMode: (mode: ProxyMode) => void;
  customProxyUrl: string;
  setCustomProxyUrl: (url: string) => void;
  effectiveProxyUrl: string | null;
  loading: boolean;
  saving: boolean;
  status: string | null;
  applyProxySettings: () => Promise<ProxySettings>;
  saveProxySettings: () => Promise<void>;
}

export function useProxySettingsController(isOpen: boolean): ProxySettingsController {
  const [mode, setMode] = useState<ProxyMode>('system');
  const [customProxyUrl, setCustomProxyUrl] = useState('');
  const [effectiveProxyUrl, setEffectiveProxyUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    let active = true;
    setLoading(true);
    setStatus(null);
    void apiClient
      .getProxySettings()
      .then((settings) => {
        if (!active) return;
        setMode(settings.mode);
        setCustomProxyUrl(settings.customProxyUrl);
        setEffectiveProxyUrl(settings.effectiveProxyUrl ?? null);
      })
      .catch(() => {
        if (!active) return;
        setMode('system');
        setCustomProxyUrl('');
        setEffectiveProxyUrl(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen]);

  const applyProxySettings = useCallback(async (): Promise<ProxySettings> => {
    setStatus(null);
    const settings = await apiClient.setProxySettings({ mode, customProxyUrl });
    setMode(settings.mode);
    setCustomProxyUrl(settings.customProxyUrl);
    setEffectiveProxyUrl(settings.effectiveProxyUrl ?? null);
    return settings;
  }, [customProxyUrl, mode]);

  const saveProxySettings = useCallback(async () => {
    setSaving(true);
    setStatus(null);
    try {
      const settings = await applyProxySettings();
      setStatus(
        settings.effectiveProxyUrl
          ? `Proxy applied: ${settings.effectiveProxyUrl}`
          : 'Proxy disabled. Direct connection will be used.',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed to save proxy settings: ${message}`);
    } finally {
      setSaving(false);
    }
  }, [applyProxySettings]);

  return {
    mode,
    setMode,
    customProxyUrl,
    setCustomProxyUrl,
    effectiveProxyUrl,
    loading,
    saving,
    status,
    applyProxySettings,
    saveProxySettings,
  };
}
