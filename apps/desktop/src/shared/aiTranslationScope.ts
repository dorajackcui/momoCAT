/** Validate and snapshot a filtered scope. An empty scope must never mean the whole file. */
export function parseAITranslationSegmentIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('AI translation requires a non-empty list of segment IDs.');
  }
  const ids = new Set<string>();
  for (const id of value) {
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('AI translation requires a non-empty list of segment IDs.');
    }
    ids.add(id);
  }
  return [...ids];
}
