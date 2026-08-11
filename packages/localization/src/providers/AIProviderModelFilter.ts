export function filterDiscoveredModelIds(models: string[]): string[] {
  const denyPatterns = [
    /embedding/i,
    /\bembed\b/i,
    /audio/i,
    /tts/i,
    /whisper/i,
    /image/i,
    /image-only/i,
    /vision-image/i,
  ];
  const seen = new Set<string>();
  const filtered: string[] = [];

  for (const rawModel of models) {
    const model = rawModel.trim();
    if (!model || seen.has(model)) {
      continue;
    }
    if (denyPatterns.some((pattern) => pattern.test(model))) {
      continue;
    }
    seen.add(model);
    filtered.push(model);
  }

  return filtered;
}
