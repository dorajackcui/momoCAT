import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  PasteSourceModal,
  buildPasteSourceFileInput,
  createPasteSourceDrafts,
  shouldInitializePasteSourceDrafts,
} from './PasteSourceModal';

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

  it('builds submitted sources from edited source drafts', () => {
    const input = buildPasteSourceFileInput(
      ['Edited A', 'Edited B'],
      'default',
    );

    expect(input).toEqual({
      sources: ['Edited A', 'Edited B'],
      tagPolicy: 'default',
    });
  });

  it('keeps HTML-derived segment boundaries when a source with cell line breaks is edited', () => {
    const clipboard = {
      html: `
        <table>
          <tbody>
            <tr>
              <td><br>【主线新篇】黄金尘<br>伊赞之土主线终章现已开启</td>
            </tr>
          </tbody>
        </table>
      `,
      text: '"\n【主线新篇】黄金尘\n伊赞之土主线终章现已开启"',
    };

    const drafts = createPasteSourceDrafts(clipboard);
    const input = buildPasteSourceFileInput(
      [`${drafts[0]}\n追加一句`],
      'default',
    );

    expect(input).toEqual({
      sources: ['【主线新篇】黄金尘\n伊赞之土主线终章现已开启\n追加一句'],
      tagPolicy: 'default',
    });
  });

  it('initializes drafts only when the modal transitions from closed to open', () => {
    expect(shouldInitializePasteSourceDrafts(false, true)).toBe(true);
    expect(shouldInitializePasteSourceDrafts(true, true)).toBe(false);
    expect(shouldInitializePasteSourceDrafts(true, false)).toBe(false);
    expect(shouldInitializePasteSourceDrafts(false, false)).toBe(false);
  });

  it('builds plain marker-like text marker handling when selected', () => {
    const input = buildPasteSourceFileInput(
      ['A'],
      'none',
    );

    expect(input).toEqual({
      sources: ['A'],
      tagPolicy: 'none',
    });
  });

  it('builds parsed clipboard sources for Create', () => {
    const drafts = createPasteSourceDrafts({ html: '', text: 'A\n\nBB' });
    const input = buildPasteSourceFileInput(
      drafts,
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
