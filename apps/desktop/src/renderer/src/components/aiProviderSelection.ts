import type { AIConnectionSummary, AIProviderSummary } from '../../../shared/ipc';

export function chooseInitialProviderModel(
  connection: AIConnectionSummary,
  providers: AIProviderSummary[],
): string {
  const configuredModels = new Set(
    providers
      .filter(
        (provider) =>
          provider.kind === 'configured' && provider.connectionId === connection.id,
      )
      .map((provider) => provider.model),
  );

  return (
    connection.discoveredModels.find((model) => !configuredModels.has(model)) ??
    connection.discoveredModels[0] ??
    ''
  );
}

export function isSavedConnectionReuseActive(
  connection: AIConnectionSummary | null,
  apiKeyInput: string,
): boolean {
  return Boolean(connection) && apiKeyInput.trim().length === 0;
}
