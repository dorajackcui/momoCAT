import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TBWithStats } from '../../../../shared/ipc';
import { TBCard } from './TBCard';

function buildTB(): TBWithStats {
  return {
    id: 'tb-1',
    name: 'Product Terms',
    srcLang: 'en-US',
    tgtLang: 'fr-FR',
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    stats: { entryCount: 63 },
    syncConfig: {
      filePath: 'D:\\references\\product-terms.xlsx',
      columns: { sourceCol: 0, targetCol: 1, hasHeader: true },
    },
  };
}

describe('TBCard', () => {
  it('exposes the linked filename as a button for synced term bases', () => {
    const html = renderToStaticMarkup(
      React.createElement(TBCard, {
        tb: buildTB(),
        onPreview: vi.fn(),
        onImport: vi.fn(),
        onSync: vi.fn(),
        onDelete: vi.fn(),
        onOpenLinkedFile: vi.fn(),
      }),
    );

    expect(html).toContain('aria-label="Open linked file product-terms.xlsx"');
    expect(html).toContain('product-terms.xlsx');
  });
});
