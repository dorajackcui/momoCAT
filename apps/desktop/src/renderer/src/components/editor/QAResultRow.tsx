import { useCallback, useSyncExternalStore } from 'react';
import type { FileQaIssueRecord } from '@cat/core/project';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { QAPanelProps } from './QAPanel';
import { Button } from '../ui';

interface Props extends Pick<QAPanelProps, 'segmentStore'> {
  segmentId: string;
  issues: FileQaIssueRecord[];
  onLocate: () => void;
}

/** Live previews subscribe per row without regrouping the full QA report on each edit. */
export function QAResultRow({ segmentId, issues, segmentStore, onLocate }: Props) {
  const subscribe = useCallback(
    (listener: () => void) => segmentStore.subscribeSegment(segmentId, listener),
    [segmentStore, segmentId],
  );
  const segment = useSyncExternalStore(subscribe, () => segmentStore.getSegment(segmentId));
  const issue = issues[0];
  const source = issue.ruleId === 'target-consistency';
  const text = segment
    ? serializeTokensToDisplayText(source ? segment.sourceTokens : segment.targetTokens)
    : '';
  const preview =
    issue.groupId && segment
      ? text.trim()
        ? text
        : source
          ? '[Empty source]'
          : '[Empty target]'
      : [...new Set(issues.map((item) => item.message))].join('; ');
  return (
    <Button
      variant="link"
      tone="inherit"
      className="w-full justify-start gap-2 text-left"
      title={preview}
      onClick={onLocate}
    >
      <span className="shrink-0 py-1 text-brand">Row {issue.row}</span>
      <span className="min-w-0 truncate">{preview}</span>
    </Button>
  );
}
