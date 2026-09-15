import { useCallback, useRef, useState } from 'react';
import { feedbackService } from '../services/feedbackService';

export type WorkspaceView =
  | { kind: 'home' | 'tm' | 'tb' | 'settings' }
  | { kind: 'project'; projectId: number }
  | { kind: 'editor'; projectId: number; fileId: number };

export type WorkspaceNavigationGuard = () => Promise<boolean>;

export function useWorkspaceNavigation() {
  const [view, setView] = useState<WorkspaceView>({ kind: 'home' });
  const [pending, setPending] = useState(false);
  const guardRef = useRef<WorkspaceNavigationGuard | null>(null);
  const pendingRef = useRef(false);

  const registerGuard = useCallback((guard: WorkspaceNavigationGuard) => {
    guardRef.current = guard;
    return () => {
      if (guardRef.current === guard) guardRef.current = null;
    };
  }, []);

  // Keep the current page mounted until its writes and the requested action succeed.
  const runGuarded = useCallback(async (action: () => Promise<WorkspaceView | null>) => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    try {
      if (guardRef.current && !(await guardRef.current())) return false;
      const next = await action();
      if (!next) return false;
      setView(next);
      return true;
    } catch (error) {
      console.error('[Workspace] Navigation failed:', error);
      feedbackService.error('Could not switch pages. Please retry.');
      return false;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, []);

  const navigate = useCallback((next: WorkspaceView) => runGuarded(async () => next), [runGuarded]);

  return { view, pending, navigate, runGuarded, registerGuard };
}
