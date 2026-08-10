import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EditorRowNumberCell } from './EditorRowNumberCell';

describe('EditorRowNumberCell', () => {
  it('puts a small 1 at the top right of the repeat marker for the first occurrence', () => {
    const html = renderToStaticMarkup(
      React.createElement(EditorRowNumberCell, {
        rowNumber: 18,
        repeatedSourceRole: 'first',
      }),
    );

    expect(html).toContain('>18<');
    expect(html).toContain('aria-label="First occurrence of repeated source"');
    expect(html).toContain('title="First occurrence of repeated source"');
    expect(html).toContain('>↻</span>');
    expect(html).toContain('-right-[3px] -top-[2px] text-[7px]');
    expect(html).toContain('>1</span>');
  });

  it('keeps the plain repeat marker for later occurrences', () => {
    const html = renderToStaticMarkup(
      React.createElement(EditorRowNumberCell, {
        rowNumber: 43,
        repeatedSourceRole: 'later',
      }),
    );

    expect(html).toContain('aria-label="Repeated source"');
    expect(html).toContain('title="Later occurrence of repeated source"');
    expect(html).toContain('>↻</span>');
    expect(html).not.toContain('>1</span>');
  });

  it('does not show the repeat marker for a unique source', () => {
    const html = renderToStaticMarkup(
      React.createElement(EditorRowNumberCell, {
        rowNumber: 12,
      }),
    );

    expect(html).not.toContain('aria-label="Repeated source"');
    expect(html).not.toContain('>↻<');
  });
});
