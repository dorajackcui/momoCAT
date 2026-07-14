import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TMWithStats } from '../../../../shared/ipc';
import { TMCard } from './TMCard';

function buildTM(): TMWithStats {
  return {
    id: 'tm-1',
    name: 'Product TM',
    srcLang: 'en-US',
    tgtLang: 'fr-FR',
    type: 'main',
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    stats: { entryCount: 63 },
    syncConfig: {
      filePath: 'D:\\references\\product-tm.xlsx',
      columns: { sourceCol: 0, targetCol: 1, hasHeader: true },
    },
  };
}

describe('TMCard', () => {
  it('omits the redundant Main TM chip and exposes the linked filename as a button', () => {
    const html = renderToStaticMarkup(
      React.createElement(TMCard, {
        tm: buildTM(),
        onPreview: vi.fn(),
        onImport: vi.fn(),
        onSync: vi.fn(),
        onDelete: vi.fn(),
        onOpenLinkedFile: vi.fn(),
      }),
    );

    expect(html).not.toContain('Main TM');
    expect(html).toContain('aria-label="Open linked file product-tm.xlsx"');
    expect(html).toContain('product-tm.xlsx');
  });
});
