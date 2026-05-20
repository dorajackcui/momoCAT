import { describe, expect, it } from 'vitest';
import { runBounded } from './RequestScheduler';

describe('runBounded', () => {
  it('respects maxConcurrency and preserves input order', async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];

    const runPromise = runBounded(
      [1, 2, 3, 4],
      async (value) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
        return value * 10;
      },
      { maxConcurrency: 2 },
    );

    await Promise.resolve();

    expect(maxActive).toBe(2);

    while (releases.length > 0) {
      releases.shift()?.();
      await Promise.resolve();
    }

    await expect(runPromise).resolves.toEqual([
      { status: 'fulfilled', value: 10 },
      { status: 'fulfilled', value: 20 },
      { status: 'fulfilled', value: 30 },
      { status: 'fulfilled', value: 40 },
    ]);
  });

  it('records item failures and continues remaining work', async () => {
    const results = await runBounded(
      ['a', 'bad', 'c'],
      async (value) => {
        if (value === 'bad') {
          throw new Error('provider failed');
        }

        return value.toUpperCase();
      },
      { maxConcurrency: 2 },
    );

    expect(results[0]).toEqual({ status: 'fulfilled', value: 'A' });
    expect(results[1].status).toBe('rejected');
    expect((results[1] as { status: 'rejected'; reason: unknown }).reason).toBeInstanceOf(Error);
    expect((results[1] as { status: 'rejected'; reason: Error }).reason.message).toBe(
      'provider failed',
    );
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'C' });
  });
});
