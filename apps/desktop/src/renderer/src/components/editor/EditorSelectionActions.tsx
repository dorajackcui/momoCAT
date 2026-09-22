import { Icon, IconButton, ControlGroup } from '../ui';
import type { SelectedSegmentAction } from '../../hooks/editor/useSelectedSegmentActions';

export interface EditorSelectionActionsProps {
  count: number;
  disabled: boolean;
  onAction: (action: SelectedSegmentAction) => void;
}

export function EditorSelectionActions({ count, disabled, onAction }: EditorSelectionActionsProps) {
  return (
    <ControlGroup label="Selected segments" variant="plain">
      <IconButton
        size="sm"
        tone="neutral"
        aria-label="Clear selected targets"
        title="Clear selected targets"
        disabled={disabled || count === 0}
        onClick={() => onAction('clear')}
      >
        <Icon name="eraser" className="h-4 w-4" />
      </IconButton>
      <IconButton
        size="sm"
        tone="neutral"
        aria-label="Copy source to selected targets"
        title="Copy source to selected targets"
        disabled={disabled || count === 0}
        onClick={() => onAction('copy-source')}
      >
        <Icon name="chevrons-right" className="h-4 w-4" />
      </IconButton>
      <IconButton
        size="sm"
        tone="neutral"
        aria-label="Confirm selected segments"
        title="Confirm selected segments (Ctrl/Cmd+Enter)"
        disabled={disabled || count === 0}
        onClick={() => onAction('confirm')}
      >
        <Icon name="check" className="h-4 w-4" />
      </IconButton>
    </ControlGroup>
  );
}
