import type { FileQaReport } from '@cat/core/project';

export interface FileQaFeedback {
  level: 'success' | 'info';
  message: string;
}

const MAX_PREVIEW_ISSUES = 5;

export function buildFileQaFeedback(fileName: string, report: FileQaReport): FileQaFeedback {
  if (report.errorCount === 0 && report.warningCount === 0) {
    return {
      level: 'success',
      message: `QA passed for "${fileName}" (${report.checkedSegments} segments).`,
    };
  }

  const previewLines = report.issues
    .slice(0, MAX_PREVIEW_ISSUES)
    .map((issue) => `Row ${issue.row} [${issue.severity}] ${issue.ruleId}: ${issue.message}`)
    .join('\n');
  const hasMore = report.issues.length > MAX_PREVIEW_ISSUES;
  const moreSuffix = hasMore ? `\n...and ${report.issues.length - MAX_PREVIEW_ISSUES} more.` : '';

  return {
    level: 'info',
    message:
      `QA finished for "${fileName}".\n` +
      `Errors: ${report.errorCount}, Warnings: ${report.warningCount}\n` +
      `${previewLines}${moreSuffix}`,
  };
}
