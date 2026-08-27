import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'sample-app',
  server: {
    port: 8080,
    strictPort: true,
    host: true,
  },
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
  },
});
