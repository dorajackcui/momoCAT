import { describe, expect, it } from 'vitest';
import { codeMirrorEditorThemeSpec } from './codemirrorAdapter';

describe('CodeMirror editor sizing', () => {
  it('leaves minimum row height to the shared target layer', () => {
    expect(codeMirrorEditorThemeSpec['.cm-content']).not.toHaveProperty('minHeight');
    expect(codeMirrorEditorThemeSpec['.cm-content']).toMatchObject({
      padding: '0',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    });
  });
});
