// @ts-ignore vitest types not available in CI build
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
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
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        name: 'IRAMS • Integrated Reliability & Asset Management Specialist',
        short_name: 'IRAMS',
        description: 'IRAMS by Relantern — AI-powered modern EAM platform for assets, maintenance, inventory & performance.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Only precache the HTML shell, CSS, and small critical assets
        globPatterns: ['**/*.{html,ico,png,svg,woff2}'],
        // Exclude large JS chunks from precache — they load on-demand via lazy routes
        maximumFileSizeToCacheInBytes: 256 * 1024, // 256KB — only small assets
        // Cache JS/CSS at runtime (on first navigation to each route)
        runtimeCaching: [
          {
            urlPattern: /\.(?:js|css)$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'js-css-cache',
              expiration: { maxEntries: 120, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: { maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
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
