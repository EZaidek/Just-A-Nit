import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Polling also detects edits through Docker Desktop bind mounts.
    watch: { usePolling: true, interval: 300 },
  },
});
