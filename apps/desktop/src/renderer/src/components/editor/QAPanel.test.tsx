// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Segment } from '@cat/core/models';
import type { FileQaIssueRecord } from '@cat/core/project';
import { QAPanel, type QAPanelProps } from './QAPanel';

function segment(source: string, target: string): Segment {
  return {
    segmentId: 'a',
    fileId: 1,
    orderIndex: 0,
    status: 'draft',
    sourceTokens: [{ type: 'text', content: source }],
    targetTokens: [{ type: 'text', content: target }],
    srcHash: '',
    matchKey: '',
    tagsSignature: '',
    meta: { updatedAt: '' },
  };
}
function props(issues: FileQaIssueRecord[], row = segment('Open', '开启')): QAPanelProps {
  return {
    issues,
    running: false,
    checked: true,
    stale: false,
    getSegment: () => row,
    onRun: vi.fn(),
    onFilter: vi.fn(),
    onLocate: vi.fn(),
  };
}
const term: FileQaIssueRecord = {
  segmentId: 'a',
  row: 8,
  ruleId: 'tb-term-missing',
  severity: 'info',
  groupId: 'term-open',
  groupLabel: 'Open → 打开',
  message: '“Open” expects “打开” (Main TB).',
  origins: ['Main TB'],
};

describe('QA result list', () => {
  it('collapses only the category and keeps its filter and numeric counts available', () => {
    const input = props([term]);
    render(<QAPanel {...input} />);
    const category = screen.getByRole('button', { name: 'Terminology · 1 row' });
    const group = screen.getByRole('button', { name: 'Open → 打开 · 1 row' });
    expect(category).toHaveTextContent(/^Terminology1$/);
    expect(group).toHaveTextContent(/^Open → 打开1$/);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Terminology' }));
    expect(screen.getByRole('button', { name: 'Expand Terminology' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(group).not.toBeVisible();
    expect(input.onFilter).not.toHaveBeenCalled();
    fireEvent.click(category);
    expect(input.onFilter).toHaveBeenCalledWith(['a'], 'Terminology');
    fireEvent.click(screen.getByRole('button', { name: 'Expand Terminology' }));
    expect(group).toBeVisible();
    expect(screen.getByRole('button', { name: 'Row 8 开启' })).toBeVisible();
  });
  it('shows one actual translation per term row, with origins on the group and live edit previews', () => {
    const input = props([
      term,
      {
        ...term,
        ruleId: 'term-conflict',
        message: 'Expected “打开”, found “开启”.',
        origins: ['Main TB', 'Other TB'],
      },
    ]);
    const { rerender } = render(<QAPanel {...input} />);
    expect(screen.queryByText(/expects|Expected/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open → 打开 · 1 row' })).toHaveAttribute(
      'title',
      'Open → 打开\nSources: Main TB, Other TB',
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Row 8 开启' }));
    expect(input.onFilter).toHaveBeenCalledWith(['a'], 'Terminology › Open → 打开');
    expect(input.onLocate).toHaveBeenCalledWith('a');
    rerender(<QAPanel {...input} stale getSegment={() => segment('Open', '打开')} />);
    expect(screen.getByRole('button', { name: 'Row 8 打开' })).toHaveAttribute('title', '打开');
    expect(screen.getByText('Changed · Recheck needed')).toBeInTheDocument();
  });

  it('shows source variants for reverse consistency and makes empty target variants explicit', () => {
    render(
      <QAPanel
        {...props(
          [
            { ...term, ruleId: 'target-consistency', groupId: 'reverse', groupLabel: '打开' },
            { ...term, ruleId: 'source-consistency', groupId: 'forward', groupLabel: 'Open' },
          ],
          segment('Open the door', ''),
        )}
      />,
    );
    expect(screen.getByRole('button', { name: 'Row 8 Open the door' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Row 8 [Empty target]' })).toBeInTheDocument();
  });

  it('keeps reference navigation and ungrouped diagnostic details', () => {
    const input = props([
      { ...term, ruleId: 'substring-consistency', references: [{ segmentId: 'b', row: 2 }] },
      {
        ...term,
        ruleId: 'number',
        groupId: undefined,
        groupLabel: undefined,
        message: 'Missing: 12; Extra: 13',
      },
    ]);
    render(<QAPanel {...input} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reference row 2' }));
    expect(input.onFilter).toHaveBeenCalledWith(
      ['a', 'b'],
      'Substring translation consistency › Open → 打开',
    );
    expect(input.onLocate).toHaveBeenCalledWith('b');
    expect(
      screen.getByRole('button', { name: 'Row 8 Missing: 12; Extra: 13' }),
    ).toBeInTheDocument();
  });
});
