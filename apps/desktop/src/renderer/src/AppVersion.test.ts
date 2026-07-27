import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('desktop app version marker', () => {
  it('shows the 1.0.8 updater UX verification version in the shell header', () => {
    const appSource = readFileSync(resolve(__dirname, 'App.tsx'), 'utf8');

    expect(appSource).toContain('>v1.0.8<');
    expect(appSource).not.toContain('>v0.2<');
  });

  it('keeps the root and desktop package versions aligned for release packaging', () => {
    const rootPackage = JSON.parse(
      readFileSync(resolve(__dirname, '../../../../../package.json'), 'utf8'),
    ) as { version?: unknown };
    const desktopPackage = JSON.parse(
      readFileSync(resolve(__dirname, '../../../package.json'), 'utf8'),
    ) as { version?: unknown };

    expect(rootPackage.version).toBe('1.0.8');
    expect(desktopPackage.version).toBe('1.0.8');
  });
});
