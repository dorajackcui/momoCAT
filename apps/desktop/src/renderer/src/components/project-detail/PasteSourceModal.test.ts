import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PasteSourceModal } from './PasteSourceModal';

describe('PasteSourceModal', () => {
  it('renders parsed source count, preview rows, and marker handling controls', () => {
    const html = renderToStaticMarkup(
      React.createElement(PasteSourceModal, {
        open: true,
        clipboard: { html: '', text: 'A\nBB' },
        creating: false,
        onClose: vi.fn(),
        onCreate: vi.fn(),
      }),
    );

    expect(html).toContain('Paste Source');
    expect(html).toContain('2 source rows');
    expect(html).toContain('A');
    expect(html).toContain('BB');
    expect(html).toContain('Protect CAT markers');
    expect(html).toContain('Plain marker-like text');
    expect(html).toContain('Create File');
  });

  it('disables creation when there are no valid sources', () => {
    const html = renderToStaticMarkup(
      React.createElement(PasteSourceModal, {
        open: true,
        clipboard: { html: '', text: '  \n\n' },
        creating: false,
        onClose: vi.fn(),
        onCreate: vi.fn(),
      }),
    );

    expect(html).toContain('No valid source rows found.');
    expect(html).toContain('disabled=""');
  });

  it('shows a soft warning for large pastes', () => {
    const rows = Array.from({ length: 5001 }, (_, index) => `row ${index + 1}`).join('\n');
    const html = renderToStaticMarkup(
      React.createElement(PasteSourceModal, {
        open: true,
        clipboard: { html: '', text: rows },
        creating: false,
        onClose: vi.fn(),
        onCreate: vi.fn(),
      }),
    );

    expect(html).toContain('5,001 source rows');
    expect(html).toContain('Large paste');
  });
});
