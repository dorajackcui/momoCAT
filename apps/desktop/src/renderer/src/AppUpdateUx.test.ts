import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('app update footer UX', () => {
  it('uses the footer as a lightweight check-for-updates entrypoint', () => {
    const appSource = readFileSync(resolve(__dirname, 'App.tsx'), 'utf8');

    expect(appSource).toContain('Check for updates');
    expect(appSource).toContain('handleCheckForUpdates');
    expect(appSource).toContain('onAppUpdateStatus');
    expect(appSource).not.toContain('Offline Mode • Spreadsheet-first v0.1');
  });
});
