/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    // The repo lives on a Windows drive mounted over 9p, where inotify events
    // do not arrive. Polling is the only reliable way to get HMR in WSL2.
    watch: { usePolling: true, interval: 300 },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
