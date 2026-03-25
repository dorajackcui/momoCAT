import { describe, expect, it } from 'vitest';
import type { FileQaReport } from '@cat/core/project';
import { buildFileQaFeedback } from './fileQaFeedback';

function createReport(overrides?: Partial<FileQaReport>): FileQaReport {
  return {
    fileId: 1,
    checkedSegments: 10,
    errorCount: 0,
    warningCount: 0,
    issues: [],
    ...overrides,
  };
}

describe('buildFileQaFeedback', () => {
  it('returns success message when no QA issues found', () => {
    const feedback = buildFileQaFeedback('demo.xlsx', createReport({ checkedSegments: 128 }));
    expect(feedback.level).toBe('success');
    expect(feedback.message).toBe('QA passed for "demo.xlsx" (128 segments).');
  });

  it('returns info message with issue preview', () => {
    const feedback = buildFileQaFeedback(
      'demo.xlsx',
      createReport({
        errorCount: 1,
        warningCount: 1,
        issues: [
          {
            segmentId: 's1',
            row: 3,
            ruleId: 'tag-integrity',
            severity: 'error',
            message: 'Missing closing tag',
          },
          {
            segmentId: 's2',
            row: 7,
            ruleId: 'terminology-consistency',
            severity: 'warning',
            message: 'Use preferred term',
          },
        ],
      }),
    );

    expect(feedback.level).toBe('info');
    expect(feedback.message).toContain('QA finished for "demo.xlsx".');
    expect(feedback.message).toContain('Errors: 1, Warnings: 1');
    expect(feedback.message).toContain('Row 3 [error] tag-integrity: Missing closing tag');
    expect(feedback.message).toContain(
      'Row 7 [warning] terminology-consistency: Use preferred term',
    );
  });

  it('appends remaining-count suffix when issue list exceeds preview limit', () => {
    const issues = Array.from({ length: 7 }, (_, idx) => ({
      segmentId: `s${idx + 1}`,
      row: idx + 1,
      ruleId: 'tag-integrity',
      severity: 'error' as const,
      message: `Issue ${idx + 1}`,
    }));
    const feedback = buildFileQaFeedback(
      'demo.xlsx',
      createReport({
        errorCount: 7,
        issues,
      }),
    );

    expect(feedback.level).toBe('info');
    expect(feedback.message).toContain('...and 2 more.');
    expect(feedback.message).not.toContain('Row 7 [error] tag-integrity: Issue 7');
  });
});
