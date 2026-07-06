// Shared CORS headers so the function can also be invoked on-demand from the
// browser (a future "Sync now" button), not just by the scheduler.
export const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
