import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PasteSourceModal, buildPasteSourceFileInput } from './PasteSourceModal';

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

  it('builds submitted sources from edited text instead of original clipboard content', () => {
    const input = buildPasteSourceFileInput(
      {
        html: '<table><tr><td>Original HTML</td></tr></table>',
        text: 'Original text',
      },
      true,
      'Edited A\nEdited B',
      'default',
    );

    expect(input).toEqual({
      sources: ['Edited A', 'Edited B'],
      tagPolicy: 'default',
    });
  });

  it('builds plain marker-like text marker handling when selected', () => {
    const input = buildPasteSourceFileInput(
      { html: '', text: 'A' },
      false,
      'ignored edit',
      'none',
    );

    expect(input).toEqual({
      sources: ['A'],
      tagPolicy: 'none',
    });
  });

  it('builds parsed clipboard sources for Create', () => {
    const input = buildPasteSourceFileInput(
      { html: '', text: 'A\n\nBB' },
      false,
      'ignored edit',
      'default',
    );

    expect(input).toEqual({
      sources: ['A', 'BB'],
      tagPolicy: 'default',
    });
  });

  it('keeps Create disabled when there are no valid sources', () => {
    const html = renderToStaticMarkup(
      React.createElement(PasteSourceModal, {
        open: true,
        clipboard: { html: '', text: '  \n\n' },
        creating: false,
        onClose: vi.fn(),
        onCreate: vi.fn(),
      }),
    );

    expect(html).toContain('disabled=""');
  });
});
