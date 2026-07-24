import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SourceDiffPane } from './SourceDiffPane';

describe('SourceDiffPane', () => {
  it('renders only the two source labels and subtle change highlights', () => {
    const html = renderToStaticMarkup(
      React.createElement(SourceDiffPane, {
        tmSourceTokens: [{ type: 'text', content: 'Old wording' }],
        currentSourceTokens: [{ type: 'text', content: 'New wording' }],
        sourceLocale: 'en-US',
      }),
    );

    expect(html).toContain('TM source');
    expect(html).toContain('Current');
    expect(html).toContain('bg-danger-soft');
    expect(html).toContain('bg-success-soft');
    expect(html).not.toContain('Source changes');
    expect(html.match(/quiet-scrollbar/g)).toHaveLength(2);
  });

  it('does not add change styling when the sources are identical', () => {
    const html = renderToStaticMarkup(
      React.createElement(SourceDiffPane, {
        tmSourceTokens: [{ type: 'text', content: 'Identical source' }],
        currentSourceTokens: [{ type: 'text', content: 'Identical source' }],
        sourceLocale: 'en-US',
      }),
    );

    expect(html).not.toContain('bg-danger-soft');
    expect(html).not.toContain('bg-success-soft');
  });
});
