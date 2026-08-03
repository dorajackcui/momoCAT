import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProjectReferenceOperationProgressModal } from './ProjectReferenceOperationProgressModal';

describe('ProjectReferenceOperationProgressModal', () => {
  it('offers cooperative cancellation for source terminology precheck', () => {
    const onCancelPrecheck = vi.fn();
    const html = renderToStaticMarkup(
      createElement(ProjectReferenceOperationProgressModal, {
        progress: { kind: 'precheck', fileId: 7, current: 3, total: 10 },
        onCancelPrecheck,
      }),
    );

    expect(html).toContain('Stop and keep partial output');
    expect(html).not.toContain('disabled=""');
  });

  it('disables repeated cancellation while the worker is stopping', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectReferenceOperationProgressModal, {
        progress: {
          kind: 'precheck',
          fileId: 7,
          current: 3,
          total: 10,
          cancelRequested: true,
        },
        onCancelPrecheck: vi.fn(),
      }),
    );

    expect(html).toContain('Stopping...');
    expect(html).toContain('disabled=""');
  });
});
