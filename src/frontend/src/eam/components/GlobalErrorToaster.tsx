import React, { useEffect, useRef } from 'react';
import { useToast } from '../contexts/ToastContext';

/**
 * Surfaces swallowed service errors (dispatched via notifyError) as a user toast.
 * Debounced so a burst of failures (e.g. several queries failing at once) shows
 * one toast instead of spamming.
 */
export const GlobalErrorToaster: React.FC = () => {
  const { showToast } = useToast();
  const lastShown = useRef(0);

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (typeof msg !== 'string' || !msg) return;
      const now = Date.now();
      if (now - lastShown.current < 3000) return; // collapse bursts
      lastShown.current = now;
      showToast(msg, 'error');
    };
    window.addEventListener('ers:error', handler);
    return () => window.removeEventListener('ers:error', handler);
  }, [showToast]);

  return null;
};
