import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EditorRowFeedback } from './EditorRowFeedback';

describe('EditorRowFeedback', () => {
  it('keeps long context as a single-line truncated visual row', () => {
    const contextText = `${'Long context text '.repeat(16)}tail-marker`;

    const html = renderToStaticMarkup(
      React.createElement(EditorRowFeedback, {
        qaIssues: [],
        contextText,
      }),
    );

    expect(html).toContain('tail-marker');
    expect(html).toContain('mt-auto');
    expect(html).toContain('text-[10px]');
    expect(html).not.toContain('text-[11px]');
    expect(html).toContain('truncate');
    expect(html).toContain('whitespace-nowrap');
    expect(html).not.toContain('more');
    expect(html).not.toContain('Collapse');
  });
});
