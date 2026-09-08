import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['backend/__tests__/**/*.test.js'],
    alias: {
      '@testing-library/jest-dom': '/frontend/node_modules/@testing-library/jest-dom',
    },
  },
});
