import { useCallback, useEffect, useRef, useState } from 'react';
import { feedbackService } from '../services/feedbackService';
import { apiClient } from '../services/apiClient';

export interface AppUpdatesController {
  statusMessage: string;
  isBusy: boolean;
  checkForUpdates: () => Promise<void>;
}

// Mounted by App so progress and completion survive leaving Settings.
export function useAppUpdates(): AppUpdatesController {
  const [statusMessage, setStatusMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const busyRef = useRef(false);
  const manualCheckRef = useRef(false);
  const progressToastBucketRef = useRef<number | null>(null);

  useEffect(() => {
    return apiClient.onAppUpdateStatus((status) => {
      setStatusMessage(status.message);
      busyRef.current =
        status.phase === 'checking' ||
        status.phase === 'available' ||
        status.phase === 'downloading';
      setIsBusy(busyRef.current);

      const shouldToast = manualCheckRef.current;
      if (status.phase === 'checking') {
        progressToastBucketRef.current = null;
        if (shouldToast) feedbackService.info(status.message);
        return;
      }
      if (status.phase === 'available') {
        if (shouldToast) feedbackService.info(status.message);
        return;
      }
      if (status.phase === 'downloading') {
        if (shouldToast && status.percent !== undefined) {
          const bucket = Math.floor(status.percent / 25);
          if (progressToastBucketRef.current !== bucket) {
            progressToastBucketRef.current = bucket;
            feedbackService.info(status.message);
          }
        }
        return;
      }

      progressToastBucketRef.current = null;
      manualCheckRef.current = false;
      if (status.phase === 'downloaded') feedbackService.success(status.message);
      else if (status.phase === 'error') feedbackService.error(status.message);
      else if (shouldToast) feedbackService.info(status.message);
    });
  }, []);

  const checkForUpdates = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    manualCheckRef.current = true;
    progressToastBucketRef.current = null;
    setIsBusy(true);
    setStatusMessage('Checking for updates...');
    try {
      await apiClient.checkForUpdates();
    } catch (error) {
      busyRef.current = false;
      manualCheckRef.current = false;
      setIsBusy(false);
      setStatusMessage('Failed to start update check.');
      feedbackService.error('Failed to start update check.');
      console.error('[Updates] Failed to start update check:', error);
    }
  }, []);

  return { statusMessage, isBusy, checkForUpdates };
}
