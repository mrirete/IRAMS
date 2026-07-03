import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { reloadOnceForStaleChunk } from './lib/lazyWithReload'

// ── Service-worker teardown ─────────────────────────────────────────────────
// The app no longer ships a service worker (vite-plugin-pwa fully retired). We
// unregister ANY lingering SW from an older PWA build and purge its caches.
// CRUCIAL: unregistering does NOT drop the SW's control of the CURRENT page —
// only a navigation/reload does. While a stale SW still controls the page its
// fetch handler can intercept/hang lazy-chunk requests → the "must log out and
// back in to open a page" bug. So when a SW was actively controlling this page,
// reload once (guarded) to escape it. This is safe now that no SW is ever
// re-registered — the old sign-out loop came from the self-destructing SW's own
// competing reload, which no longer exists.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    if (regs.length === 0) return;
    const wasControlled = !!navigator.serviceWorker.controller;
    Promise.all(regs.map((r) => r.unregister()))
      .then(() => (typeof caches !== 'undefined' ? caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))) : null))
      .then(() => { if (wasControlled) reloadOnceForStaleChunk(); })
      .catch(() => {});
  }).catch(() => {});
}

// ── Auto-recover from stale/hung lazy-chunk loads after a deploy ─────────────
// When a new build deploys, an already-open page still references the OLD hashed
// route chunks. Navigating to a lazy route then fails to import the now-purged
// chunk → blank/spinner until a manual refresh. Vite dispatches `vite:preloadError`
// for exactly this; reload once (shared guard in lazyWithReload) to pull the
// fresh build. (Hung — never-rejecting — imports are handled by lazyWithReload's
// own timeout.)
window.addEventListener('vite:preloadError', (e) => { e.preventDefault(); reloadOnceForStaleChunk(); });
// Belt-and-braces: catch the dynamic-import failure if it surfaces as a rejection.
window.addEventListener('unhandledrejection', (e) => {
  const msg = String(e?.reason?.message || e?.reason || '');
  if (/dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(msg)) {
    reloadOnceForStaleChunk();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
