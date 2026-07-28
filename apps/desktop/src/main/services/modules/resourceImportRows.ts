// Shared last-wins reduction for spreadsheet-backed resource writes (TM/TB
// import and sync). A file is treated as a key -> entry mapping where later
// rows override earlier ones, so every DB write path receives rows that are
// already unique on their conflict key. This keeps SQL ON CONFLICT clauses
// meaning one thing only: how file entries interact with pre-existing DB
// entries.

export interface DedupedRows<T> {
  /** Unique rows in first-occurrence order, each holding its last-seen value. */
  rows: T[];
  /** Rows dropped because an identical key appeared again later in the file. */
  duplicates: number;
  /** Rows dropped because keyOf returned null (invalid row). */
  invalid: number;
}

/**
 * Collapse rows that share a conflict key, keeping the LAST occurrence's
 * value. Output preserves the order in which each key first appeared, so
 * chunked writes stay deterministic with respect to the source file.
 */
export function dedupeRowsLastWins<T>(
  rows: readonly T[],
  keyOf: (row: T) => string | null,
): DedupedRows<T> {
  const byKey = new Map<string, T>();
  let invalid = 0;

  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) {
      invalid += 1;
      continue;
    }
    byKey.set(key, row);
  }

  return {
    rows: Array.from(byKey.values()),
    duplicates: rows.length - invalid - byKey.size,
    invalid,
  };
}
