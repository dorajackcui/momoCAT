import { useCallback, useEffect, useState } from 'react';
import type { CloudStatus } from '../../../shared/cloud';
import { Button } from './ui';

export function useCloudStatus() {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const refresh = useCallback(async () => {
    const next = await window.api.cloudStatus?.();
    if (next) setStatus(next);
    return next;
  }, []);
  useEffect(() => {
    // This only reads main-process local state; it makes no cloud requests.
    void refresh().catch(() => {});
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
      {status?.account && !status.project && (
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
  onSave,
  onPull,
  onClose,
}: {
  status: CloudStatus;
  onSave: () => void;
  onPull: () => void;
  onClose: () => void;
}) {
  if (!status.project) return null;
  const project = status.project;
  return (
    <div className="shrink-0 border-b border-border px-4 py-2 text-sm" role="status">
      <div className="flex items-center justify-between gap-3">
        <span>
          Cloud · {project.name} · v{project.revision} ·{' '}
          {project.pending ? 'Changes saved on this device' : 'Saved to cloud'}
        </span>
        <div className="flex gap-2">
          <Button size="sm" disabled={!project.writable} onClick={onSave}>
            Save to cloud
          </Button>
          <Button size="sm" disabled={!project.writable} onClick={onPull}>
            Get latest
          </Button>
          <Button size="sm" disabled={!project.writable} onClick={onClose}>
            Close project
          </Button>
        </div>
      </div>
      {project.error && <p className="mt-2">{project.error}</p>}
      <p className="mt-1 text-xs text-text-muted">
        Save to cloud before switching devices. Changes stay on this device until you save.
      </p>
    </div>
  );
}
