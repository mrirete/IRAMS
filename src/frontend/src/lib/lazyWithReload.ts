/**
 * lazyWithReload — resilient React.lazy for route chunks.
 *
 * Route chunks are fetched over connections that can HANG, not just fail
 * (evidence: same-origin fetches to the CDN observed pending forever). A hung
 * import() is poison: React.lazy caches the pending promise for the whole
 * session, so the route spins until a full reload. Recovery strategy, in
 * order — every path is TERMINAL (resolve, reload, or a visible error);
 * nothing may leave Suspense spinning forever:
 *
 *  1. Race the import against a timeout, retry once (a REJECTED import can
 *     re-fetch; a HUNG one re-joins the same pending request and the second
 *     timeout moves us on).
 *  2. On a chunk-load failure → reload once (stale hash after a deploy, or a
 *     poisoned connection — the reload gets a fresh one). Rate-limited.
 *  3. If reloads are exhausted, or the module threw while EVALUATING (a real
 *     code error a reload can't fix) → throw, so the ErrorBoundary shows a
 *     message + "Reload Application" instead of a silent spinner.
 *
 * Prevention beats recovery: prefetchRegisteredRoutes() warms every chunk in
 * the background right after boot (the boot connection demonstrably works —
 * the shell just loaded over it), so navigation normally never waits on the
 * network at all.
 */
import { lazy, type ComponentType } from 'react';

const RELOAD_GUARD = 'ers_chunk_reload_at';     // shared with main.tsx
const RELOAD_COUNT = 'ers_chunk_reload_count';
const TIMEOUT_MS = 10000;
const RELOAD_WINDOW_MS = 120000;
const MAX_RELOADS_PER_WINDOW = 2;

export function reloadOnceForStaleChunk(): boolean {
    try {
        const now = Date.now();
        const last = Number(sessionStorage.getItem(RELOAD_GUARD) || 0);
        const inWindow = now - last < RELOAD_WINDOW_MS;
        const count = inWindow ? Number(sessionStorage.getItem(RELOAD_COUNT) || 0) : 0;
        // Refuse a back-to-back reload or a reload storm — the caller must
        // surface an error instead of looping (or hanging) forever.
        if (now - last < 10000 || count >= MAX_RELOADS_PER_WINDOW) return false;
        sessionStorage.setItem(RELOAD_GUARD, String(now));
        sessionStorage.setItem(RELOAD_COUNT, String(count + 1));
    } catch { /* private mode — reload anyway */ }
    window.location.reload();
    return true;
}

// ── Boot-time route prefetch ────────────────────────────────────────────────
type ChunkFactory = () => Promise<unknown>;
const registeredFactories: ChunkFactory[] = [];

/** Register a chunk for boot-time warm-up without wrapping it in lazy(). */
export function registerRoutePrefetch(factory: ChunkFactory): void {
    registeredFactories.push(factory);
}

/**
 * Warm every registered route chunk over the healthy boot connection, a few
 * at a time. Failures are ignored — this is prevention only; navigation still
 * has its own recovery path.
 */
export function prefetchRegisteredRoutes(): void {
    const queue = [...registeredFactories];
    const LANES = 3;
    const next = () => {
        const factory = queue.shift();
        if (!factory) return;
        Promise.resolve()
            .then(factory)
            .catch(() => { /* background warm-up only */ })
            .then(() => setTimeout(next, 150)); // stagger — don't starve real requests
    };
    for (let i = 0; i < LANES; i++) next();
}

const importWithTimeout = <T,>(factory: () => Promise<T>): Promise<T> =>
    Promise.race([
        factory(),
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('chunk-load-timeout')), TIMEOUT_MS),
        ),
    ]);

export function lazyWithReload<T extends ComponentType<any>>(
    factory: () => Promise<{ default: T }>,
) {
    registerRoutePrefetch(factory);
    return lazy(async () => {
        try {
            return await importWithTimeout(factory);
        } catch {
            // Retry once before escalating.
            try {
                return await importWithTimeout(factory);
            } catch (err: any) {
                const msg = String(err?.message || err);
                const isChunkLoad = /timeout|dynamically imported|Importing a module script failed|Failed to fetch|ChunkLoadError|error loading/i.test(msg);
                if (isChunkLoad && reloadOnceForStaleChunk()) {
                    console.warn('[lazyWithReload] chunk failed to load — reloading:', msg);
                    return new Promise<{ default: T }>(() => { /* superseded by the reload */ });
                }
                // Module eval error, or reloads exhausted → make it visible.
                console.error('[lazyWithReload] route module failed to load:', err);
                throw isChunkLoad
                    ? new Error('This page could not be loaded — the network stalled while fetching it. Use "Reload Application" to retry.')
                    : err;
            }
        }
    });
}
