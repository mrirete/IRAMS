
import { createClient } from '@supabase/supabase-js';

// ── Supabase Configuration ──────────────────────────────────────────
// The anon key is a PUBLIC/publishable key — safe to include in client code.
// Row Level Security (RLS) policies protect data, not the key.
// Environment variables override these defaults when available.
const SUPABASE_URL_DEFAULT = 'https://hacrebcfvyqdnjvilhqc.supabase.co';
const SUPABASE_ANON_KEY_DEFAULT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhY3JlYmNmdnlxZG5qdmlsaHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mjk5ODAsImV4cCI6MjA4NzEwNTk4MH0.F-2Fordc833NAuprdRBmm5s-Bd5fQsO0vxUK7_06AJ0';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || SUPABASE_URL_DEFAULT;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || SUPABASE_ANON_KEY_DEFAULT;


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
});
