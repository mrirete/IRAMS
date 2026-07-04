
import { createClient, processLock } from '@supabase/supabase-js';

// ── Supabase Configuration ──────────────────────────────────────────
// The anon key is a PUBLIC/publishable key — safe to include in client code.
// Row Level Security (RLS) policies protect data, not the key.
// Environment variables override these defaults when available.
const SUPABASE_URL_DEFAULT = 'https://hacrebcfvyqdnjvilhqc.supabase.co';
const SUPABASE_ANON_KEY_DEFAULT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhY3JlYmNmdnlxZG5qdmlsaHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mjk5ODAsImV4cCI6MjA4NzEwNTk4MH0.F-2Fordc833NAuprdRBmm5s-Bd5fQsO0vxUK7_06AJ0';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || SUPABASE_URL_DEFAULT;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || SUPABASE_ANON_KEY_DEFAULT;


// Retry transient network failures on reads. Supabase's edge occasionally drops
// a reused HTTP/2 connection, so a request rejects with `TypeError: Failed to
// fetch` (net::ERR_CONNECTION_CLOSED). Without a retry, the page/provider that
// issued it hangs on its loading state until a full re-login opens fresh
// connections (a reload reuses the bad connection pool — which is exactly why
// "log out and back in" was the only thing that worked). Retrying on a new
// connection makes these self-heal.
//
// Only rejected NETWORK errors are retried, and only for idempotent reads
// (GET/HEAD) — HTTP error responses (4xx/5xx) resolve normally and pass straight
// through, and writes/auth POSTs are never re-sent (no duplicate-write risk).
const fetchWithRetry: typeof fetch = async (input, init) => {
    const method = (init?.method || (typeof input !== 'string' && 'method' in (input as Request) ? (input as Request).method : 'GET') || 'GET').toUpperCase();
    const retryable = method === 'GET' || method === 'HEAD';
    const MAX_ATTEMPTS = retryable ? 4 : 1;
    const PER_ATTEMPT_TIMEOUT_MS = 10_000; // a dropped connection can HANG (pending), not just reject
    const callerSignal = init?.signal ?? undefined;
    let lastErr: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (callerSignal?.aborted) throw (callerSignal as any).reason ?? new DOMException('Aborted', 'AbortError');
        // Per-attempt AbortController: abort a hung request so the loop can retry
        // on a fresh connection instead of spinning forever. Chained to the caller's
        // own signal so caller cancellation still propagates.
        const ctrl = new AbortController();
        const onCallerAbort = () => ctrl.abort((callerSignal as any)?.reason);
        callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
        const timer = setTimeout(() => ctrl.abort(new DOMException('Request timed out', 'TimeoutError')), PER_ATTEMPT_TIMEOUT_MS);
        try {
            return await fetch(input, { ...init, signal: ctrl.signal });
        } catch (err: any) {
            lastErr = err;
            // Caller genuinely aborted (not our per-attempt timeout) → don't retry.
            if (callerSignal?.aborted) throw err;
            if (!retryable || attempt >= MAX_ATTEMPTS) throw err;
            await new Promise(r => setTimeout(r, 300 * attempt)); // 300ms, 600ms, 900ms
        } finally {
            clearTimeout(timer);
            callerSignal?.removeEventListener('abort', onCallerAbort);
        }
    }
    throw lastErr;
};

// Single shared client. Creating additional createClient() instances in the same
// browser shares this storage key and causes GoTrue refresh-token rotation races:
// one instance rotates the refresh token, the others' stale token then fails →
// spurious sign-out → login loop (worst on mobile, where tabs get suspended and
// resumed). ALWAYS import this instance; never call createClient() elsewhere.
export const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Use the in-memory processLock instead of the default navigatorLock.
        // navigator.locks can DEADLOCK (a held lock is never released — happens
        // after tab backgrounding / token-refresh timing), so getSession() and
        // every query that needs the session HANG until a fresh sign-in resets
        // the client. That is exactly the "must log out to open pages" bug,
        // consistent across all browser profiles with a healthy network.
        // processLock serialises refresh within the tab without navigator.locks.
        lock: processLock,
    },
    global: { fetch: fetchWithRetry },
});
