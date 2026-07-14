import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EditorRowNumberCell } from './EditorRowNumberCell';

describe('EditorRowNumberCell', () => {
  it('shows a subtle repeat marker below the row number', () => {
    const html = renderToStaticMarkup(
      React.createElement(EditorRowNumberCell, {
        rowNumber: 18,
        isRepeatedSource: true,
      }),
    );

    expect(html).toContain('>18<');
    expect(html).toContain('aria-label="Repeated source"');
    expect(html).toContain('>↻<');
  });

  it('does not show the repeat marker for the first occurrence', () => {
    const html = renderToStaticMarkup(
      React.createElement(EditorRowNumberCell, {
        rowNumber: 12,
        isRepeatedSource: false,
      }),
    );

    expect(html).not.toContain('aria-label="Repeated source"');
    expect(html).not.toContain('>↻<');
  });
});
