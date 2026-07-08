/**
 * friendlyAIError — translate raw AI-stack failures (Gemini API errors, Edge
 * Function non-2xx, network) into one calm, user-facing sentence.
 *
 * Users should never see "429 RESOURCE_EXHAUSTED {'error': {'code': 429 …"
 * or "Edge Function returned a non-2xx status code". The raw error still goes
 * to the console for diagnosis — this is only what we render.
 */
export function friendlyAIError(raw: unknown): string {
    const msg = String((raw as { message?: unknown })?.message ?? raw ?? '');
    const lower = msg.toLowerCase();

    // Quota / billing exhaustion (Gemini: 429 RESOURCE_EXHAUSTED, credits depleted)
    if (
        lower.includes('resource_exhausted') || lower.includes('429') ||
        lower.includes('quota') || lower.includes('credits') || lower.includes('rate limit')
    ) {
        return 'The AI assistant has reached its usage limit, so this feature is paused for now. Everything else keeps working — an administrator can restore AI features from the AI service billing page.';
    }

    // Edge Function failed (usually the same quota issue, surfaced server-side)
    if (lower.includes('non-2xx') || lower.includes('edge function') || lower.includes('functionshttperror')) {
        return "The AI assistant couldn't complete this request — most often this means the AI usage limit was reached. Try again shortly; if it persists, ask an administrator to check the AI service.";
    }

    // Local connectivity
    if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('disconnected')) {
        return "Couldn't reach the AI service — check your internet connection and try again.";
    }

    // Misconfiguration (bad/missing API key, permissions)
    if (lower.includes('api key') || lower.includes('unauthorized') || lower.includes('403') || lower.includes('permission')) {
        return "The AI service isn't configured correctly — ask an administrator to check the AI settings.";
    }

    return "The AI assistant couldn't complete this request. Try again shortly; if it keeps happening, ask an administrator to check the AI service.";
}
