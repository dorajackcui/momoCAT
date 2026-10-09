// @vitest-environment jsdom

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NonPrintingText } from './NonPrintingText';

function render(text: string, enabled: boolean) {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<NonPrintingText text={text} enabled={enabled} />);
  return host;
}

describe('NonPrintingText', () => {
  it('keeps real spaces and literal symbols when marks are enabled', () => {
    const text = 'sa fin\u00A0! prix\u202F: 20\u00A0€\t·°◦⇥';
    const host = render(text, true);
    expect(host.textContent).toBe(text);
    expect(host.querySelector('.cm-np-space')?.textContent).toBe(' ');
    expect(host.querySelectorAll('.cm-np-nbsp')).toHaveLength(2);
    expect(host.querySelector('.cm-np-nbsp')?.textContent).toBe('\u00A0');
    expect(host.querySelector('.cm-np-nnbsp')?.textContent).toBe('\u202F');
    expect(host.querySelector('.cm-np-tab')?.textContent).toBe('\t');
  });

  it('removes only display decorations when the switch is off', () => {
    const text = 'sa fin\u00A0! prix\u202F:';
    const host = render(text, false);
    expect(host.textContent).toBe(text);
    expect(host.querySelector('[class]')).toBeNull();
  });

  it('keeps line breaks and literal marks unchanged in DOM text and copied selections', () => {
    const host = render('constructor\n°·⇥', true);
    expect(host.textContent).toBe('constructor\n°·⇥');
    const range = document.createRange();
    range.selectNodeContents(host);
    expect(range.toString()).toBe('constructor\n°·⇥');
    expect(host.querySelectorAll('[class]')).toHaveLength(1);
    expect(host.querySelector('.cm-np-newline')?.textContent).toBe('');
  });
});
