import { useCallback, useEffect, useId, useRef, useState } from 'react';
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

export function CloudSyncControl({
  status,
  onSync,
  onResolveConflict,
  disabled = false,
}: {
  status: CloudStatus | null;
  onSync: () => void;
  onResolveConflict: () => void;
  disabled?: boolean;
}) {
  const descriptionId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (!status?.account) return null;
  const syncing = status.syncing || status.project?.syncing;
  const pending = status.pending || status.pendingElsewhere || status.project?.pending;
  const conflict = status.conflict || status.project?.conflict;
  const error = status.error || status.project?.error;
  const lastSyncedAt = status.lastSyncedAt || status.project?.lastSyncedAt;
  const blocked = disabled || !!syncing || status.project?.writable === false;
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
  const description = `${label}${lastSyncedAt ? `. Last sync ${new Date(lastSyncedAt).toLocaleString()}` : ''}`;
  const hasIssue = !!(error || conflict);
  return (
    <>
      <span className="relative inline-flex shrink-0">
        <IconButton
          size="sm"
          variant="ghost"
          tone={hasIssue ? 'danger' : 'neutral'}
          disabled={blocked}
          onClick={() => (hasIssue ? setDetailsOpen(true) : onSync())}
          title={`Sync with cloud · ${description}`}
          aria-label="Sync with cloud"
          aria-describedby={descriptionId}
          aria-haspopup={hasIssue ? 'dialog' : undefined}
        >
          <Icon
            name={syncing ? 'refresh-cw' : hasIssue ? 'shield-alert' : 'cloud'}
            className={`h-4 w-4${syncing ? ' animate-spin' : ''}`}
          />
        </IconButton>
        {pending && !hasIssue && !syncing && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-brand-solid"
          />
        )}
        <span id={descriptionId} className="sr-only" role="status">
          {description}
        </span>
      </span>
      <Modal
        open={detailsOpen}
        title={conflict ? 'Sync conflict' : error ? 'Sync failed' : 'Cloud sync'}
        size="sm"
        onClose={() => setDetailsOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDetailsOpen(false)}>
              Close
            </Button>
            {conflict ? (
              <Button
                variant="primary"
                disabled={blocked}
                onClick={() => {
                  setDetailsOpen(false);
                  onResolveConflict();
                }}
              >
                Save local copy and get latest
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={blocked}
                onClick={() => {
                  setDetailsOpen(false);
                  onSync();
                }}
              >
                Retry sync
              </Button>
            )}
          </>
        }
      >
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <p className="text-sm text-text-muted">
          {conflict
            ? 'Both this device and cloud have changes. Your local work is preserved. Save a local copy before receiving the cloud version.'
            : 'Your local work is preserved. Retry when you are ready.'}
        </p>
      </Modal>
    </>
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
