import type { ProxySettings, ProxySettingsInput } from '../../../../shared/ipc';
import type { AITransport, SettingsRepository } from '../../ports';
import type { ProxySettingsApplier } from '../../proxy/ProxySettingsManager';

export class AISettingsService {
  public static readonly AI_API_KEY = 'openai_api_key';
  private static readonly PROXY_MODE_KEY = 'app_proxy_mode';
  private static readonly PROXY_URL_KEY = 'app_proxy_url';

  constructor(
    private readonly settingsRepo: SettingsRepository,
    private readonly transport: AITransport,
    private readonly proxySettingsManager: ProxySettingsApplier,
  ) {}

  public getAISettings(): { apiKeySet: boolean; apiKeyLast4?: string } {
    const apiKey = this.settingsRepo.getSetting(AISettingsService.AI_API_KEY);
    if (!apiKey) {
      return { apiKeySet: false };
    }
    return { apiKeySet: true, apiKeyLast4: apiKey.slice(-4) };
  }

  public setAIKey(apiKey: string): void {
    this.settingsRepo.setSetting(AISettingsService.AI_API_KEY, apiKey);
  }

  public clearAIKey(): void {
    this.settingsRepo.setSetting(AISettingsService.AI_API_KEY, null);
  }

  public getProxySettings(): ProxySettings {
    return {
      mode: this.readProxyMode(),
      customProxyUrl: this.readStoredProxyUrl(),
      effectiveProxyUrl: this.proxySettingsManager.getEffectiveProxyUrl(),
    };
  }

  public setProxySettings(settings: ProxySettingsInput): ProxySettings {
    const mode = settings.mode;
    const customProxyUrl = settings.customProxyUrl?.trim() ?? this.readStoredProxyUrl();
    const applied = this.proxySettingsManager.applySettings({ mode, customProxyUrl });

    this.settingsRepo.setSetting(AISettingsService.PROXY_MODE_KEY, applied.mode);
    this.settingsRepo.setSetting(AISettingsService.PROXY_URL_KEY, applied.customProxyUrl || null);

    return {
      ...applied,
      effectiveProxyUrl: this.proxySettingsManager.getEffectiveProxyUrl(),
    };
  }

  public applySavedProxySettings(): ProxySettings {
    const mode = this.readProxyMode();
    const customProxyUrl = this.readStoredProxyUrl();
    const applied = this.proxySettingsManager.applySettings({ mode, customProxyUrl });

    return {
      ...applied,
      customProxyUrl,
      effectiveProxyUrl: this.proxySettingsManager.getEffectiveProxyUrl(),
    };
  }

  public async testAIConnection(apiKey?: string): Promise<{ ok: true }> {
    const key =
      (apiKey && apiKey.trim()) || this.settingsRepo.getSetting(AISettingsService.AI_API_KEY);
    if (!key) {
      throw new Error('API key is not set');
    }
    await this.transport.testConnection({
      apiKey: key,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4-mini',
    });
    return { ok: true };
  }

  public getStoredApiKey(): string | undefined {
    return this.settingsRepo.getSetting(AISettingsService.AI_API_KEY);
  }

  private readProxyMode(): ProxySettings['mode'] {
    const mode = this.settingsRepo.getSetting(AISettingsService.PROXY_MODE_KEY);
    if (mode === 'off' || mode === 'custom' || mode === 'system') {
      return mode;
    }
    return 'system';
  }

  private readStoredProxyUrl(): string {
    return this.settingsRepo.getSetting(AISettingsService.PROXY_URL_KEY)?.trim() ?? '';
  }
}
