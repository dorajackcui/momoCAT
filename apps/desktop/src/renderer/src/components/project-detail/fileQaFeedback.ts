import type { FileQaReport } from '@cat/core/project';

export interface FileQaFeedback {
  level: 'success' | 'info';
  message: string;
}

const MAX_PREVIEW_ISSUES = 5;

export function buildFileQaFeedback(fileName: string, report: FileQaReport): FileQaFeedback {
  if (report.stale)
    return { level: 'info', message: `"${fileName}" changed during QA. Recheck needed.` };
  if (report.issues.length === 0) {
    return {
      level: 'success',
      message: `QA passed for "${fileName}" (${report.checkedSegments} segments).`,
    };
  }

  const previewLines = report.issues
    .slice(0, MAX_PREVIEW_ISSUES)
    .map((issue) => `Row ${issue.row} ${issue.ruleId}: ${issue.message}`)
    .join('\n');
  const hasMore = report.issues.length > MAX_PREVIEW_ISSUES;
  const moreSuffix = hasMore ? `\n...and ${report.issues.length - MAX_PREVIEW_ISSUES} more.` : '';

  return {
    level: 'info',
    message:
      `QA finished for "${fileName}".\n` +
      `${report.issues.length} findings in ${new Set(report.issues.map((issue) => issue.segmentId)).size} rows\n` +
      `${previewLines}${moreSuffix}`,
  };
}
