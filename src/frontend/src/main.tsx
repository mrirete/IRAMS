import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

// ── Auto-recover from stale lazy-chunk loads after a deploy ──────────────────
// When a new build deploys, an already-open page still references the OLD hashed
// route chunks. Navigating to a lazy route (clicking an item to open its detail)
// then fails to import the now-purged chunk → blank screen until a manual
// refresh. Vite dispatches `vite:preloadError` for exactly this; reload once to
// pull the fresh build. A one-shot sessionStorage guard prevents reload loops if
// a chunk is genuinely unreachable (offline, etc.).
const RELOAD_GUARD = 'ers_chunk_reload_at';
const reloadOnceForStaleChunk = () => {
  const last = Number(sessionStorage.getItem(RELOAD_GUARD) || 0);
  if (Date.now() - last < 10000) return; // already tried very recently — avoid a loop
  sessionStorage.setItem(RELOAD_GUARD, String(Date.now()));
  window.location.reload();
};
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
