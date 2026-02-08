import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/sse': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/sse/, ''),
      },
      '/auth': 'http://localhost:4000',
      '/chat': 'http://localhost:4000',
      '/quiz': 'http://localhost:4000',
      '/me': 'http://localhost:4000',
      '/health': 'http://localhost:4000',
    },
  },
});


