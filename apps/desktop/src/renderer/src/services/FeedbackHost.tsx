import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Modal } from '../components/ui';
import {
  ConfirmOptions,
  installFeedbackHandlers,
  isConfirmRequirementMet,
} from './feedbackService';

interface ConfirmRequest extends ConfirmOptions {
  id: number;
  resolve: (confirmed: boolean) => void;
}

export function FeedbackHost() {
  const nextIdRef = useRef(1);
  const activeRequestRef = useRef<ConfirmRequest | null>(null);
  const queueRef = useRef<ConfirmRequest[]>([]);
  const [activeRequest, setActiveRequest] = useState<ConfirmRequest | null>(null);
  const [typedConfirmation, setTypedConfirmation] = useState('');

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
    });

    return () => {
      uninstall();
      activeRequestRef.current?.resolve(false);
      queueRef.current.forEach((request) => request.resolve(false));
      queueRef.current = [];
      activeRequestRef.current = null;
    };
  }, [showRequest]);

  const canConfirm = isConfirmRequirementMet(activeRequest ?? {}, typedConfirmation);
  const requiresTypedConfirmation = Boolean(activeRequest?.requiredText);

  return (
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
  );
}
