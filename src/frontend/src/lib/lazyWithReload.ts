/**
 * lazyWithReload — resilient React.lazy for route chunks.
 *
 * main.tsx recovers from chunk load *errors* (vite:preloadError / rejected
 * dynamic import). But a chunk request can also *hang* (a lingering
 * service worker intercepting fetches, a stalled CDN response, a flaky
 * network) — the import promise then never resolves and Suspense spins
 * forever, so the user is stuck until a full navigation (e.g. logging out
 * and back in). This wrapper races the import against a timeout and, on a
 * hang or failure, reloads once (guarded against loops) to pull the chunk
 * fresh — which also escapes any stale SW controlling the page.
 */
import { lazy, type ComponentType } from 'react';

const RELOAD_GUARD = 'ers_chunk_reload_at'; // shared with main.tsx
const TIMEOUT_MS = 10000;

export function reloadOnceForStaleChunk(): void {
    try {
        const last = Number(sessionStorage.getItem(RELOAD_GUARD) || 0);
        if (Date.now() - last < 10000) return; // already tried very recently — avoid a loop
        sessionStorage.setItem(RELOAD_GUARD, String(Date.now()));
    } catch { /* private mode — reload anyway */ }
    window.location.reload();
}

export function lazyWithReload<T extends ComponentType<any>>(
    factory: () => Promise<{ default: T }>,
) {
    return lazy(() =>
        Promise.race([
            factory(),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('chunk-load-timeout')), TIMEOUT_MS),
            ),
        ]).catch((): Promise<{ default: T }> => {
            // Hang or failure → recover by reloading once. The returned promise
            // never resolves; the page reload takes over (or, if guard-blocked,
            // Suspense keeps its fallback rather than crashing).
            reloadOnceForStaleChunk();
            return new Promise<{ default: T }>(() => { /* superseded by reload */ });
        }),
    );
}
