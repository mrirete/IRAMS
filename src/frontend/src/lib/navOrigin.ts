/**
 * Router-state origin: where a page was opened from, so it can offer the way
 * back ({ to: '/admin/migration', label: 'Migration Center' }). Only an object
 * of exactly this shape counts — other pages use router state for other things.
 */
export interface NavOrigin { to: string; label: string }

export function readOrigin(state: unknown): NavOrigin | null {
    if (!state || typeof state !== 'object') return null;
    const { to, label } = state as Record<string, unknown>;
    return typeof to === 'string' && to.startsWith('/') && typeof label === 'string' && label.trim() ? { to, label } : null;
}
