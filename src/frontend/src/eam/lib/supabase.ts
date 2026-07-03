
import { createClient } from '@supabase/supabase-js';

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
    const MAX_ATTEMPTS = 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            return await fetch(input, init);
        } catch (err: any) {
            lastErr = err;
            // Never retry a caller-aborted request or a non-idempotent one.
            if (!retryable || err?.name === 'AbortError' || init?.signal?.aborted) throw err;
            if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 250 * attempt)); // 250ms, 500ms
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
    },
    global: { fetch: fetchWithRetry },
});
