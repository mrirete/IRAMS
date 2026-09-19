/**
 * useIdleTimeout — signs a session out after a period with no human input.
 *
 * Global Settings has carried a "Session Timeout" value since the settings page
 * was written. Nothing read it: the number was stored on the company record and
 * displayed back on the same screen that wrote it, so an administrator who set
 * 15 minutes got the same never-expiring session as one who set 480. This hook
 * is the consumer that makes the number true.
 *
 * What counts as activity: pointer, keyboard, scroll and touch on the window,
 * plus the tab becoming visible again. Each one restarts the clock. A warning
 * fires one minute before the deadline so the session does not vanish mid-form.
 *
 * Deliberately NOT a security boundary on its own. The access token's own
 * lifetime is what stops a stolen token being replayed; this closes the far more
 * ordinary case of an unattended workstation in a control room or a shared
 * tablet on the shop floor. Treat it as the hygiene control it is.
 *
 * `minutes <= 0` disables the timer entirely, which is how "never" is spelled.
 */
import { useEffect, useRef, useState } from 'react';

const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'wheel'] as const;

/** How long before the deadline the warning appears. */
const WARN_LEAD_MS = 60_000;

/** Ignore mousemove storms — one reset a second is plenty. */
const THROTTLE_MS = 1_000;

export interface IdleTimeoutState {
    /** True once the session is inside the final minute. */
    warning: boolean;
    /** Whole seconds left when `warning` is true, else null. */
    secondsLeft: number | null;
    /** Clear the warning and restart the clock. */
    staySignedIn: () => void;
}

export function useIdleTimeout(minutes: number, onTimeout: () => void): IdleTimeoutState {
    const [warning, setWarning] = useState(false);
    const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

    // Held in refs so re-renders never restart the clock and a stale closure
    // never calls a previous render's signOut.
    const deadlineRef = useRef<number>(0);
    const lastResetRef = useRef<number>(0);
    const onTimeoutRef = useRef(onTimeout);
    onTimeoutRef.current = onTimeout;

    const totalMs = minutes > 0 ? minutes * 60_000 : 0;

    useEffect(() => {
        if (totalMs <= 0) {
            setWarning(false);
            setSecondsLeft(null);
            return;
        }

        const reset = () => {
            deadlineRef.current = Date.now() + totalMs;
            setWarning(false);
            setSecondsLeft(null);
        };

        const onActivity = () => {
            const now = Date.now();
            // Once the warning is up, only an explicit "stay signed in" clears
            // it. Otherwise a stray mousemove from a passing sleeve would keep
            // an abandoned session alive forever, which is the whole failure
            // this setting exists to prevent.
            if (deadlineRef.current - now <= WARN_LEAD_MS) return;
            if (now - lastResetRef.current < THROTTLE_MS) return;
            lastResetRef.current = now;
            reset();
        };

        reset();

        for (const evt of ACTIVITY_EVENTS) {
            window.addEventListener(evt, onActivity, { passive: true });
        }
        const onVisible = () => { if (document.visibilityState === 'visible') onActivity(); };
        document.addEventListener('visibilitychange', onVisible);

        // One second tick. Wall-clock comparison, not an accumulated counter, so
        // a laptop that slept through the deadline signs out on wake instead of
        // resuming with time left on a timer that was never running.
        const tick = window.setInterval(() => {
            const remaining = deadlineRef.current - Date.now();
            if (remaining <= 0) {
                window.clearInterval(tick);
                onTimeoutRef.current();
                return;
            }
            if (remaining <= WARN_LEAD_MS) {
                setWarning(true);
                setSecondsLeft(Math.ceil(remaining / 1000));
            }
        }, 1000);

        return () => {
            window.clearInterval(tick);
            for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, onActivity);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [totalMs]);

    const staySignedIn = () => {
        if (totalMs <= 0) return;
        deadlineRef.current = Date.now() + totalMs;
        lastResetRef.current = Date.now();
        setWarning(false);
        setSecondsLeft(null);
    };

    return { warning, secondsLeft, staySignedIn };
}
