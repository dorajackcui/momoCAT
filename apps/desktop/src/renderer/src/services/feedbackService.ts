export interface FeedbackService {
  info: (message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  confirm: (request: ConfirmRequestInput) => Promise<boolean>;
}

export type ConfirmVariant = 'primary' | 'danger';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ConfirmVariant;
  requiredText?: string;
  requiredTextLabel?: string;
}

export type ConfirmRequestInput = string | ConfirmOptions;

interface FeedbackHandlers {
  confirm?: (request: ConfirmOptions) => Promise<boolean>;
}

let feedbackHandlers: FeedbackHandlers = {};

export function installFeedbackHandlers(handlers: FeedbackHandlers): () => void {
  const previousHandlers = feedbackHandlers;
  feedbackHandlers = { ...feedbackHandlers, ...handlers };
  const installedHandlers = feedbackHandlers;

  return () => {
    if (feedbackHandlers === installedHandlers) {
      feedbackHandlers = previousHandlers;
    }
  };
}

export function resetFeedbackHandlersForTest(): void {
  feedbackHandlers = {};
}

export function normalizeConfirmRequest(request: ConfirmRequestInput): ConfirmOptions {
  return typeof request === 'string' ? { message: request } : request;
}

export function isConfirmRequirementMet(
  request: Pick<ConfirmOptions, 'requiredText'>,
  typedValue: string,
): boolean {
  return !request.requiredText || typedValue === request.requiredText;
}

const showAlert = (message: string): void => {
  if (typeof window !== 'undefined' && typeof window.alert === 'function') {
    window.alert(message);
    return;
  }

  console.warn(`[feedback] ${message}`);
};

const showConfirm = async (request: ConfirmRequestInput): Promise<boolean> => {
  const normalizedRequest = normalizeConfirmRequest(request);

  if (feedbackHandlers.confirm) {
    return feedbackHandlers.confirm(normalizedRequest);
  }

  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    return window.confirm(normalizedRequest.message);
  }

  console.warn(`[feedback:confirm:fallback=true] ${normalizedRequest.message}`);
  return true;
};

// Minimal unified boundary. Can be swapped with toast/modal implementation later.
export const feedbackService: FeedbackService = {
  info: showAlert,
  success: showAlert,
  error: showAlert,
  confirm: showConfirm,
};
