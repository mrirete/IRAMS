/**
 * Lightweight global error surfacer.
 *
 * Services have no React/toast access, so when they catch an error they've
 * historically swallowed it (console only) — which is how the Pareto ran as dead
 * code for ages and RCA saves failed silently. Call notifyError() from a catch and
 * the top-level <GlobalErrorToaster> turns it into a user-visible toast, so
 * failures fail LOUD instead of vanishing.
 */
export function notifyError(message: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ers:error', { detail: message }));
  }
}
