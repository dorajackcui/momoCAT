import { AppearancePicker, ControlGroup, IconButton } from '../ui';

interface EditorDisplayControlsProps {
  canRunActions: boolean;
  showNonPrintingSymbols: boolean;
  onToggleNonPrintingSymbols: () => void;
}

export function EditorDisplayControls({
  canRunActions,
  showNonPrintingSymbols,
  onToggleNonPrintingSymbols,
}: EditorDisplayControlsProps) {
  return (
    <ControlGroup label="Display settings" variant="plain">
      <IconButton
        tone={showNonPrintingSymbols ? 'brand' : 'neutral'}
        size="sm"
        type="button"
        onClick={onToggleNonPrintingSymbols}
        disabled={!canRunActions}
        aria-label="Toggle non-printing symbols"
        aria-pressed={showNonPrintingSymbols}
        title={showNonPrintingSymbols ? 'Hide non-printing symbols' : 'Show non-printing symbols'}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
          />
        </svg>
      </IconButton>
      <AppearancePicker label="Editor appearance" />
    </ControlGroup>
  );
}
