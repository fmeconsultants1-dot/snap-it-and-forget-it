import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * STABILIZATION MODE — Service Worker / PWA disabled.
 *
 * The VitePWA plugin and its Workbox service worker are temporarily
 * removed so that:
 *   1. No old cached SW can serve stale frontend assets.
 *   2. Every browser load fetches current assets from the network.
 *   3. Acceptance testing reflects the actual deployed code.
 *
 * To restore the PWA after stabilization is complete:
 *   - Re-add VitePWA({ ... }) here.
 *   - Delete the SW unregister script from index.html (or let the build
 *     tool regenerate registerSW.js).
 *
 * The SW unregister snippet in index.html actively clears any
 * previously installed service worker and its caches from the browser.
 */
export default defineConfig({
  plugins: [
    react(),
    // VitePWA intentionally disabled during stabilization.
    // Restore after acceptance testing is complete.
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          router: ['react-router-dom'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
