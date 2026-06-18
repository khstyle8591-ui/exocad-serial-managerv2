import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Web-server build of the Serial Manager renderer.
// Uses base '/manage/' so assets resolve correctly when served at that path.
// For Electron desktop, use vite.config.mts (base: './') instead.
export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  base: '/manage/',
  build: {
    outDir: '../../dist/manager',
    emptyOutDir: true,
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.mts', '.json'],
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      '/api/': 'http://localhost:3000',
      '/portal': 'http://localhost:3000',
    },
  },
});
