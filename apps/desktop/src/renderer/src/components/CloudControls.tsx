import { useCallback, useEffect, useRef, useState } from 'react';
import type { CloudStatus } from '../../../shared/cloud';
import { Button, Icon, IconButton, Modal } from './ui';

export function useCloudStatus() {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    const next = await window.api.cloudStatus?.();
    if (next && request === generation.current) setStatus(next);
    return next;
  }, []);
  useEffect(() => {
    // This only reads main-process local state; it makes no cloud requests.
    void Promise.resolve()
      .then(refresh)
      .catch(() => {});
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [refresh]);
  return { status, refresh };
}

export function CloudAccountControls({ status }: { status: CloudStatus | null }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Cloud operation failed');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => {
      void window.api
        .cloudPollLogin()
        .then((done) => {
          if (done) setCode('');
        })
        .catch((error) => {
          setMessage(String(error));
          setCode('');
        });
    }, 6000);
    return () => clearInterval(timer);
  }, [code]);
  return (
    <div className="space-y-3" aria-label="Cloud account">
      <p className="text-sm text-text-muted">
        {!status?.configured
          ? status?.configurationError || 'Cloud service is not configured on this device.'
          : status.account
            ? `Signed in as ${status.account.email}`
            : 'Sign in to create cloud projects and continue them on another computer.'}
      </p>
      {status?.configured && !status.account && (
        <Button
          type="button"
          disabled={busy || !!code}
          onClick={() =>
            void perform(async () => {
              setCode((await window.api.cloudStartLogin()).userCode);
            })
          }
        >
          Sign in with GitHub
        </Button>
      )}
      {status?.account && !status.project && !status.context && (
        <Button
          type="button"
          disabled={busy}
          onClick={() => void perform(() => window.api.cloudLogout())}
        >
          Sign out
        </Button>
      )}
      {code && (
        <p className="text-sm" role="status">
          Confirm this code in your browser: <strong>{code}</strong>
        </p>
      )}
      {message && (
        <p className="text-sm" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

export function CloudBanner({
  status,
  onSync,
  onResolveConflict,
}: {
  status: CloudStatus;
  onSync: () => void;
  onResolveConflict: () => void;
}) {
  if (!status.project && status.context !== 'cloud') return null;
  const syncing = status.syncing || status.project?.syncing;
  const pending = status.pending ?? status.project?.pending;
  const conflict = status.conflict || status.project?.conflict;
  const error = status.error || status.project?.error;
  const lastSyncedAt = status.lastSyncedAt || status.project?.lastSyncedAt;
  const label = syncing
    ? 'Syncing…'
    : conflict
      ? 'Sync conflict'
      : error
        ? 'Sync failed'
        : pending
          ? 'Unsynced changes'
          : lastSyncedAt
            ? 'Synced'
            : 'Ready to sync';
  return (
    <div className="shrink-0 border-b border-border px-4 py-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1" role="status">
          <span className="flex items-center gap-2">
            <Icon name="cloud" />
            {status.project?.name ||
              (status.resourceKind === 'tm' ? 'Cloud TMs' : 'Cloud term bases')}
          </span>
          <span className={error || conflict ? 'text-danger' : 'text-text-muted'}>{label}</span>
          {lastSyncedAt && (
            <span className="text-xs text-text-muted" title={lastSyncedAt}>
              Last sync {new Date(lastSyncedAt).toLocaleString()}
            </span>
          )}
        </div>
        <IconButton
          size="sm"
          variant="ghost"
          disabled={!!syncing || status.project?.writable === false}
          onClick={onSync}
          title="Sync with cloud"
          aria-label="Sync with cloud"
        >
          <Icon name="refresh-cw" className={`h-4 w-4${syncing ? ' animate-spin' : ''}`} />
        </IconButton>
      </div>
      {error && (
        <p className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      {conflict && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <span className="text-text-muted">
            Both this device and cloud have changes. Your local work is preserved.
          </span>
          <Button size="xs" variant="secondary" disabled={!!syncing} onClick={onResolveConflict}>
            Save local copy and get latest
          </Button>
        </div>
      )}
    </div>
  );
}

export type CloudCloseChoice = 'sync' | 'keep' | 'cancel';

export function CloudCloseDialog({
  open,
  onChoose,
}: {
  open: boolean;
  onChoose: (choice: CloudCloseChoice) => void;
}) {
  return (
    <Modal
      open={open}
      title="Sync before closing?"
      size="sm"
      onClose={() => onChoose('cancel')}
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="secondary" onClick={() => onChoose('cancel')}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={() => onChoose('keep')}>
            Keep on this device and close
          </Button>
          <Button variant="primary" onClick={() => onChoose('sync')}>
            Sync and close
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-muted">
        You have changes saved on this device. Sync to continue them on another computer.
      </p>
    </Modal>
  );
}
