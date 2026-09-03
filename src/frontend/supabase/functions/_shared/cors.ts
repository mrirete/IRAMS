// Shared CORS headers so the function can also be invoked on-demand from the
// browser (a future "Sync now" button), not just by the scheduler.
//
// `corsHeaders` keeps the permissive default for scheduler-driven functions.
// Privileged functions (bearer auth + service-role work: agent-run, ai-proxy)
// use `corsFor(req)`: the origin is echoed only when it is on the allowlist
// (ALLOWED_ORIGINS, comma-separated; defaults to the product host and local
// dev), otherwise the first allowed origin is returned and the browser blocks
// the cross-site read. Same posture audit-invite already had.
export const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DEFAULT_ALLOWED = 'https://irams.vercel.app,http://localhost:5173,http://localhost:4173';

/**
 * The product hosts are ALWAYS allowed; ALLOWED_ORIGINS (set on this project
 * for audit-invite's marketing-site door) adds to them, never replaces them —
 * otherwise a secret meant for one function silently locks the app out of
 * another.
 */
export function allowedOrigins(): string[] {
    const extra = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
    return [...DEFAULT_ALLOWED.split(','), ...extra];
}

export function corsFor(req: Request): Record<string, string> {
    const origin = req.headers.get('origin') ?? '';
    const allowed = allowedOrigins();
    // Vercel preview deployments (*.vercel.app under the same project) are
    // allowed too, so a preview build can call the functions.
    const previewOk = /^https:\/\/irams-[a-z0-9-]+-mrirete-3248s-projects\.vercel\.app$/.test(origin);
    const allow = allowed.includes(origin) || previewOk ? origin : allowed[0];
    return {
        'Access-Control-Allow-Origin': allow,
        'Vary': 'Origin',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
}
