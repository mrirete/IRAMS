import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
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
        manualChunks: {
          // ── Core vendor (React + Router) — cached long-term ──
          'vendor-react': [
            'react',
            'react-dom',
            'react-router-dom',
          ],

          // ── Supabase client — separate chunk ──
          'vendor-supabase': [
            '@supabase/supabase-js',
          ],

          // ── Charts (Recharts) — only loaded by pages that use charts ──
          'vendor-charts': [
            'recharts',
          ],

          // ── Icons — tree-shaken but still large ──
          'vendor-icons': [
            'lucide-react',
          ],

          // ── Heavy libs loaded on demand ──
          'vendor-pdf': [
            'jspdf',
          ],

          // ── Spreadsheet processing ──
          'vendor-xlsx': [
            'xlsx',
          ],
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
})
