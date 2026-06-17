import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'src/portal-client',
  base: '/',
  build: {
    outDir: '../../dist/portal-client',
    emptyOutDir: true,
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/portal': 'http://localhost:3000',
    },
  },
});
