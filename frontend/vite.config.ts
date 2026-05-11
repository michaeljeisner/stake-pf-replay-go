import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@bindings': fileURLToPath(new URL('./bindings/github.com/MJE43/stake-pf-replay-go', import.meta.url)),
      '@desktop-bindings': fileURLToPath(new URL('./bindings/github.com/MJE43/stake-pf-replay-go-desktop', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
});
