import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: 'packages/core/src/platform/react-hooks/src',
  plugins: [react() as any],
  test: {
    globals: true,
    environment: 'jsdom',
  },
  resolve: {
    alias: {
      '@ably/pubsub-core': path.resolve(__dirname, 'packages', 'core', 'build', 'ably.js'),
    },
  },
});
