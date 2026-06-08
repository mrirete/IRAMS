
import { createClient } from '@supabase/supabase-js';


const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

console.log('[Supabase] URL:', supabaseUrl);
console.log('[Supabase] Key starts with:', supabaseKey?.substring(0, 20));

if (!supabaseUrl || !supabaseKey) {
    console.warn('Supabase URL or Key is missing. Check .env.local');
}

// Fallback to empty strings to prevent immediate crash, 
// though functionality will fail if keys are missing.
export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseKey || 'placeholder-key');
