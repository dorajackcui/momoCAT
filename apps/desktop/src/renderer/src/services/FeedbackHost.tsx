import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Modal } from '../components/ui';
import type { NotifyTone } from './feedbackService';
import {
  ConfirmOptions,
  installFeedbackHandlers,
  isConfirmRequirementMet,
} from './feedbackService';

interface ConfirmRequest extends ConfirmOptions {
  id: number;
  resolve: (confirmed: boolean) => void;
}

interface ToastItem {
  id: number;
  message: string;
  tone: NotifyTone;
}

const TOAST_DURATION_MS = 3000;

const toastToneClass: Record<NotifyTone, string> = {
  success: 'notice-success',
  error: 'notice-danger',
  info: 'notice-info',
};

export function FeedbackHost() {
  const nextIdRef = useRef(1);
  const activeRequestRef = useRef<ConfirmRequest | null>(null);
  const queueRef = useRef<ConfirmRequest[]>([]);
  const [activeRequest, setActiveRequest] = useState<ConfirmRequest | null>(null);
  const [typedConfirmation, setTypedConfirmation] = useState('');
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showRequest = useCallback((request: ConfirmRequest | null) => {
    activeRequestRef.current = request;
    setTypedConfirmation('');
    setActiveRequest(request);
  }, []);

  const settleActiveRequest = useCallback((confirmed: boolean) => {
    const currentRequest = activeRequestRef.current;
    if (currentRequest) {
      currentRequest.resolve(confirmed);
    }
    showRequest(queueRef.current.shift() ?? null);
  }, [showRequest]);

  const addToast = useCallback((message: string, tone: NotifyTone) => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION_MS);
  }, []);

  useEffect(() => {
    const uninstall = installFeedbackHandlers({
      confirm: (options) =>
        new Promise<boolean>((resolve) => {
          const request: ConfirmRequest = {
            ...options,
            id: nextIdRef.current,
            resolve,
          };
          nextIdRef.current += 1;

          if (activeRequestRef.current) {
            queueRef.current.push(request);
            return;
          }

          showRequest(request);
        }),
      notify: addToast,
    });

    return () => {
      uninstall();
      activeRequestRef.current?.resolve(false);
      queueRef.current.forEach((request) => request.resolve(false));
      queueRef.current = [];
      activeRequestRef.current = null;
    };
  }, [showRequest, addToast]);

  const canConfirm = isConfirmRequirementMet(activeRequest ?? {}, typedConfirmation);
  const requiresTypedConfirmation = Boolean(activeRequest?.requiredText);

  return (
    <>
      <Modal
        open={Boolean(activeRequest)}
        title={activeRequest?.title ?? 'Confirm Action'}
        onClose={() => settleActiveRequest(false)}
        closeOnBackdrop={false}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => settleActiveRequest(false)}>
              {activeRequest?.cancelLabel ?? 'Cancel'}
            </Button>
            <Button
              variant={activeRequest?.confirmVariant ?? 'primary'}
              onClick={() => settleActiveRequest(true)}
              disabled={!canConfirm}
              autoFocus={!requiresTypedConfirmation}
            >
              {activeRequest?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        <p key={activeRequest?.id} className="text-sm text-text-muted">
          {activeRequest?.message}
        </p>
        {activeRequest?.requiredText && (
          <div className="space-y-2">
            <label className="field-label" htmlFor="feedback-confirm-input">
              {activeRequest.requiredTextLabel ?? 'Type the required text to confirm'}
            </label>
            <div className="text-sm font-semibold text-text break-all">{activeRequest.requiredText}</div>
            <input
              id="feedback-confirm-input"
              autoFocus
              type="text"
              value={typedConfirmation}
              onChange={(event) => setTypedConfirmation(event.target.value)}
              className="field-input"
            />
          </div>
        )}
      </Modal>

      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-40 flex flex-col gap-2 pointer-events-none">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`notice ${toastToneClass[toast.tone]} animate-toast-in pointer-events-auto shadow-float max-w-sm`}
            >
              {toast.message}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
