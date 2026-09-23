import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('desktop app version marker', () => {
  it('keeps the root and desktop package versions aligned for release packaging', () => {
    const rootPackage = JSON.parse(
      readFileSync(resolve(__dirname, '../../../../../package.json'), 'utf8'),
    ) as { version?: unknown };
    const desktopPackage = JSON.parse(
      readFileSync(resolve(__dirname, '../../../package.json'), 'utf8'),
    ) as { version?: unknown };

    expect(rootPackage.version).toBe('1.2.0');
    expect(desktopPackage.version).toBe('1.2.0');
  });
});
