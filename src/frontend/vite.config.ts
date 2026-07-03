// @ts-ignore vitest types not available in CI build
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// ── Build stamp ── injected so the running app can show exactly which commit is
// deployed (compare to `git rev-parse --short HEAD`). Vercel sets the git SHA env;
// fall back to a local `git` call, then 'dev'.
const BUILD_SHA =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
  (() => { try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return 'dev' } })()
const BUILD_TIME = new Date().toISOString()

// https://vite.dev/config/
export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  plugins: [
    react(),
    // ── NO service worker ──────────────────────────────────────────────────
    // vite-plugin-pwa is fully retired. Even the self-destroying SW still
    // controlled the page while active and could intercept/hang lazy-chunk
    // requests — the "must log out and back in to open a page" bug. With no SW
    // emitted, the app is always served fresh from Vercel's CDN. main.tsx
    // unregisters any lingering SW from an older build (and reloads once to drop
    // its control). Deploy freshness is handled SW-free via version.json below.
    //
    // Emit a tiny, uncached version.json at build time. The running app polls it
    // to detect a newer deploy and offer a one-click refresh (see UpdateBanner).
    {
      name: 'emit-version-json',
      generateBundle() {
        // @ts-ignore — rollup PluginContext provides emitFile at runtime
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ sha: BUILD_SHA, builtAt: BUILD_TIME }),
        });
      },
    },
  ],

  build: {
    // Increase chunk size warning threshold
    chunkSizeWarningLimit: 600,

    rollupOptions: {
      output: {
        manualChunks(id) {
          // ── Core vendor (React + Router) — cached long-term ──
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/react-router')) {
            return 'vendor-react';
          }

          // ── Supabase client ──
          if (id.includes('@supabase/')) {
            return 'vendor-supabase';
          }

          // ── Charts (Recharts) — only loaded by pages that use charts ──
          if (id.includes('recharts') || id.includes('d3-')) {
            return 'vendor-charts';
          }

          // ── Icons (lucide-react) ──
          if (id.includes('lucide-react')) {
            return 'vendor-icons';
          }

          // ── Heavy vendor libs — split from index ──
          if (id.includes('jspdf')) return 'vendor-pdf';
          if (id.includes('xlsx')) return 'vendor-xlsx';
          if (id.includes('@tanstack/react-query')) return 'vendor-query';
          if (id.includes('@google/generative-ai')) return 'vendor-gemini';
          if (id.includes('date-fns')) return 'vendor-datefns';

          // ── AI / Agent panel — deferred until user opens panel ──
          if (id.includes('/agent-panel/') || id.includes('RelanternAI') || id.includes('AIContextService') || id.includes('geminiService')) {
            return 'ai-panel';
          }

          // ── PDF generation — only needed for exports ──
          if (id.includes('jspdf') || id.includes('html2canvas')) {
            return 'pdf';
          }

          // ── DevicePreviewer — dev-only, never needed initially ──
          if (id.includes('DevicePreviewer')) {
            return 'dev-tools';
          }

          // ── Heavy EAM page internals — split large service files ──
          if (id.includes('AIAnalysisEngine') || id.includes('AnalyzeService')) {
            return 'ai-analysis';
          }
          if (id.includes('PredictionService')) {
            return 'ai-prediction';
          }
        },
      },
    },

    // Enable source maps for debugging (optional, remove for smaller deploy)
    sourcemap: false,

    // Target modern browsers for smaller output
    target: 'es2022',

    // Minification
    minify: 'esbuild',
  },

  // @ts-ignore - vitest config extension
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
})
