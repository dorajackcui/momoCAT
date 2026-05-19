export type ScheduledResult<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown };

export interface RunBoundedOptions {
  maxConcurrency?: number;
}

function normalizeConcurrency(itemCount: number, maxConcurrency?: number): number {
  if (itemCount === 0) {
    return 0;
  }

  const defaultConcurrency = Math.min(4, itemCount);
  const requestedConcurrency =
    typeof maxConcurrency === 'number' && Number.isFinite(maxConcurrency)
      ? Math.floor(maxConcurrency)
      : defaultConcurrency;

  return Math.max(1, Math.min(itemCount, requestedConcurrency));
}

export async function runBounded<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  options?: RunBoundedOptions,
): Promise<Array<ScheduledResult<R>>> {
  if (items.length === 0) {
    return [];
  }

  const maxConcurrency = normalizeConcurrency(items.length, options?.maxConcurrency);
  const results = new Array<ScheduledResult<R>>(items.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    const index = nextIndex;
    nextIndex += 1;

    if (index >= items.length) {
      return;
    }

    try {
      results[index] = { status: 'fulfilled', value: await worker(items[index], index) };
    } catch (reason) {
      results[index] = { status: 'rejected', reason };
    }

    await runNext();
  }

  await Promise.all(Array.from({ length: maxConcurrency }, () => runNext()));

  return results;
}
