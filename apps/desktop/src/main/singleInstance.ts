export interface FocusableWindow {
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

export function focusPrimaryWindow(windows: readonly FocusableWindow[]): void {
  const primaryWindow = windows[0];
  if (!primaryWindow) return;

  if (primaryWindow.isMinimized()) primaryWindow.restore();
  primaryWindow.show();
  primaryWindow.focus();
}
