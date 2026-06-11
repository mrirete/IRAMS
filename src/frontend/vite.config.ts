import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
/// <reference types="vitest" />
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Don't precache large chunks — let them load on demand
        maximumFileSizeToCacheInBytes: 1024 * 1024, // 1MB — covers main bundle + CSS
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

          // ── DevicePreviewer — dev-only, never needed initially ──
          if (id.includes('DevicePreviewer')) {
            return 'dev-tools';
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
